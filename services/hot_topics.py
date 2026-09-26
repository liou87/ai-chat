import json
import logging
from datetime import timedelta
import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from database import HotTopics
from services import websearch as websearch_service
from services import clock
from services.llm import get_client, MODEL_NAME

logger = logging.getLogger(__name__)

# GitHub 搜索 API 不支持一次查询里对多个 topic 做 OR，只能分开查再合并去重；
# 挑这三个覆盖面不完全重叠的 topic：通用 agent、更宽泛的 agentic 系统、检索增强
GITHUB_TOPICS = ["ai-agent", "agentic-ai", "rag"]
GITHUB_LOOKBACK_DAYS = 30   # 只看最近一个月内新建的仓库，不然会被存量的老牌大项目占满
GITHUB_PER_TOPIC = 3

TAVILY_QUERY = "AI agent LLM framework news this week"
TAVILY_MAX_RESULTS = 6


async def _fetch_github_repos() -> list:
    """
    单个 topic 查询失败（比如撞到限流）只跳过这个 topic，不影响其它的；
    多个 topic 之间可能查到同一个仓库，按 id 去重，按星数从高到低排。
    """
    since = (clock.now() - timedelta(days=GITHUB_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    seen = {}
    async with httpx.AsyncClient(timeout=15) as client:
        for topic in GITHUB_TOPICS:
            try:
                resp = await client.get(
                    "https://api.github.com/search/repositories",
                    params={"q": f"topic:{topic} created:>{since}", "sort": "stars", "order": "desc",
                            "per_page": GITHUB_PER_TOPIC},
                    headers={"Accept": "application/vnd.github+json"},
                )
                resp.raise_for_status()
                for r in resp.json().get("items", []):
                    seen[r["id"]] = {
                        "name": r["full_name"],
                        "url": r["html_url"],
                        "description": r.get("description") or "",
                        "stars": r["stargazers_count"],
                    }
            except Exception:
                logger.warning(f"GitHub 搜索 topic:{topic} 失败，跳过这个 topic", exc_info=True)
    return sorted(seen.values(), key=lambda x: -x["stars"])


async def _fetch_ai_news() -> list:
    results = await websearch_service.web_search(TAVILY_QUERY, max_results=TAVILY_MAX_RESULTS)
    if results and "error" in results[0]:
        logger.warning(f"联网搜索热点新闻失败或未配置：{results[0]['error']}")
        return []
    return results


def _fallback_items(repos: list, news: list) -> list:
    """DeepSeek 调用失败时的兜底：不做筛选和总结，直接各取几条拼起来，保证卡片不会空着。"""
    items = []
    for r in repos[:3]:
        items.append({"title": r["name"], "url": r["url"], "summary": r["description"] or f"{r['stars']} stars"})
    for n in news[:3]:
        items.append({"title": n["title"], "url": n["url"], "summary": (n.get("content") or "")[:80]})
    return items


async def _compose_with_llm(repos: list, news: list) -> list:
    prompt = (
        "从下面这些 GitHub 仓库和新闻里，挑出对一个正在找 agent 开发方向工作的人来说最值得看的 5 条左右，"
        "跳过明显是垃圾仓库、广告或者跟 AI/LLM/agent 开发没什么关系的条目；"
        "GitHub 仓库要是没有 description 或者内容看不出实际做什么的，也跳过。"
        "每条给一句话说清楚为什么值得关注，不要只是复述标题或者描述原文。"
        '按 JSON 格式返回：{"items": [{"title":..., "url":..., "summary":...}]}，不要输出别的内容。\n\n'
        f"GitHub 仓库：{json.dumps(repos, ensure_ascii=False)}\n\n"
        f"新闻：{json.dumps(news, ensure_ascii=False)}\n"
    )
    response = await get_client().chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    return data.get("items", [])


def _serialize(row: HotTopics) -> dict:
    return {
        "topic_date": row.topic_date.isoformat(),
        "items": json.loads(row.items) if row.items else [],
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def _get_row(db: AsyncSession, day) -> HotTopics | None:
    return (await db.execute(select(HotTopics).where(HotTopics.topic_date == day))).scalars().first()


async def _collect_items() -> list:
    """GitHub 搜索 + Tavily 新闻各自失败都不影响另一边，两边都没查到东西就返回空列表；DeepSeek 筛选失败时退化成不筛选的原始拼接。"""
    repos = await _fetch_github_repos()
    news = await _fetch_ai_news()

    items = []
    if repos or news:
        try:
            items = await _compose_with_llm(repos, news)
        except Exception:
            logger.error("筛选 AI 热点失败，改用不筛选的兜底列表", exc_info=True)
        if not items:
            items = _fallback_items(repos, news)
    return items


async def get_or_create_today_topics(db: AsyncSession) -> dict:
    """拿今天的热点列表，没有就现查一份存起来。"""
    today = clock.today()
    existing = await _get_row(db, today)
    if existing:
        return _serialize(existing)

    items = await _collect_items()
    row = HotTopics(topic_date=today, items=json.dumps(items, ensure_ascii=False))
    try:
        db.add(row)
        await db.commit()
    except IntegrityError:
        # 极小概率的竞态：调度任务和用户开页面几乎同时触发，读已经存在的那条就行
        await db.rollback()
        return _serialize(await _get_row(db, today))
    await db.refresh(row)
    return _serialize(row)


async def regenerate_today_topics(db: AsyncSession) -> dict:
    """用户手动点"重新收集"：重新查一遍，覆盖今天那条。会消耗 Tavily 和 DeepSeek 额度。"""
    today = clock.today()
    items = await _collect_items()
    row = await _get_row(db, today)
    if row is None:
        row = HotTopics(topic_date=today)
        db.add(row)
    row.items = json.dumps(items, ensure_ascii=False)
    row.created_at = clock.now()
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


async def get_topics_by_date(db: AsyncSession, day) -> dict | None:
    """查看历史某一天的热点，只读库，不会现查（过去的热点补查也没意义）。"""
    row = await _get_row(db, day)
    return _serialize(row) if row else None


async def list_topic_dates(db: AsyncSession, limit: int = 30) -> list[str]:
    """有热点记录的日期，新的在前，给前端做日期切换用。"""
    result = await db.execute(select(HotTopics.topic_date).order_by(HotTopics.topic_date.desc()).limit(limit))
    return [d.isoformat() for d in result.scalars().all()]
