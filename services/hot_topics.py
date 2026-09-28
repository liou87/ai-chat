import json
import logging
from datetime import timedelta
from urllib.parse import urlparse
import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from database import HotTopics
from services import websearch as websearch_service
from services import clock
from services.llm import get_client, MODEL_NAME

logger = logging.getLogger(__name__)

# 每天的热点分两组：最新消息（新闻）和 GitHub 新项目，各有固定名额，页面上也分两块显示。
NEWS_QUOTA = 5
REPO_QUOTA = 3

# 新闻用 Tavily 的新闻模式，只搜最近两天，分几个角度搜，中英文都有；摘要统一用中文写
NEWS_QUERIES = [
    "AI model release",
    "AI agent product launch",
    "open source LLM agent framework release",
    "AI 大模型 智能体 发布",
]
NEWS_PER_QUERY = 6
NEWS_LOOKBACK_DAYS = 2

# GitHub 搜索 API 不支持一次查询里对多个 topic 做 OR，只能分开查再合并去重；
# 挑这三个覆盖面不完全重叠的 topic：通用 agent、更宽泛的 agentic 系统、检索增强
GITHUB_TOPICS = ["ai-agent", "agentic-ai", "rag"]
GITHUB_LOOKBACK_DAYS = 30   # 只看最近一个月内新建的仓库，不然会被存量的老牌大项目占满
GITHUB_PER_TOPIC = 8        # 多取一些，去掉最近几天推过的之后还有得挑

# 最近这么多天推过的链接不再重复出现（不然同几个仓库会连着好几天霸榜）
DEDUPE_DAYS = 7


async def _fetch_github_repos(exclude_urls: set) -> list:
    """
    单个 topic 查询失败（比如撞到限流）只跳过这个 topic，不影响其它的；
    多个 topic 之间可能查到同一个仓库，按 id 去重，去掉最近推过的，按星数从高到低排。
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
                    if r["html_url"].lower() in exclude_urls:
                        continue
                    seen[r["id"]] = {
                        "name": r["full_name"],
                        "url": r["html_url"],
                        "description": r.get("description") or "",
                        "stars": r["stargazers_count"],
                    }
            except Exception:
                logger.warning(f"GitHub 搜索 topic:{topic} 失败，跳过这个 topic", exc_info=True)
    return sorted(seen.values(), key=lambda x: -x["stars"])


async def _fetch_ai_news(exclude_urls: set) -> list:
    """几个角度各搜一次最近两天的新闻，按链接去重，去掉最近推过的。单个搜索失败只跳过那一个。"""
    since = (clock.today() - timedelta(days=NEWS_LOOKBACK_DAYS)).isoformat()
    seen = {}
    for query in NEWS_QUERIES:
        results = await websearch_service.web_search(query, max_results=NEWS_PER_QUERY, topic="news", start_date=since)
        if results and "error" in results[0]:
            logger.warning(f"搜索热点新闻失败：{query}：{results[0]['error']}")
            continue
        for r in results:
            url = (r.get("url") or "").strip()
            if not url or url.lower() in exclude_urls or url in seen:
                continue
            seen[url] = {
                "title": r.get("title") or "",
                "url": url,
                "content": (r.get("content") or "")[:400],
                "published_date": r.get("published_date"),
            }
    return list(seen.values())


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.removeprefix("www.")
    except ValueError:
        return ""


def _news_item(n: dict, summary: str | None = None, title: str | None = None) -> dict:
    return {"kind": "news", "title": title or n["title"], "url": n["url"], "summary": summary or n["content"][:80],
            "source": _domain(n["url"]), "published_date": n.get("published_date")}


def _repo_item(r: dict, summary: str | None = None) -> dict:
    return {"kind": "github", "title": r["name"], "url": r["url"], "summary": summary or r["description"] or "",
            "stars": r["stars"]}


async def _compose_with_llm(repos: list, news: list) -> tuple[list, list]:
    """让 DeepSeek 分别从新闻和仓库里挑，返回 (新闻 [{url,title,summary}], 仓库 [{url,summary}])。"""
    prompt = (
        "你在给一个正在找 AI agent 开发方向工作的人做每日 AI 热点简报，分两组挑选：\n"
        f"1. 最新消息：从「新闻」里挑 {NEWS_QUOTA} 条最值得看的。优先模型发布、agent 产品/平台、开源框架、"
        "重要的行业动态；跳过股票分析、投资建议、广告软文、与 AI 技术无关的政治新闻、以及「本周新闻汇总」「榜单」这类聚合页；"
        "同一件事的多篇报道只留一篇。中英文新闻都可以选。\n"
        f"2. GitHub 新项目：从「GitHub 仓库」里挑 {REPO_QUOTA} 个。跳过没有 description、看不出实际做什么、"
        "或者只是资料合集的仓库。\n"
        "每条用一句中文说清楚它是什么、为什么值得关注，不要只是复述标题。"
        "新闻的 title 用简洁的中文标题（英文标题翻译过来，不要超过 30 个字）。\n"
        '按 JSON 返回：{"news": [{"url":..., "title":..., "summary":...}], "repos": [{"url":..., "summary":...}]}，'
        "url 必须原样来自下面的数据，不要输出别的内容。\n\n"
        f"新闻：{json.dumps(news, ensure_ascii=False)}\n\n"
        f"GitHub 仓库：{json.dumps(repos, ensure_ascii=False)}\n"
    )
    response = await get_client().chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    return data.get("news", []), data.get("repos", [])


async def _recent_urls(db: AsyncSession) -> set:
    """最近 DEDUPE_DAYS 天（不含今天）推过的链接，小写，用来去重。"""
    today = clock.today()
    rows = (await db.execute(
        select(HotTopics).where(HotTopics.topic_date >= today - timedelta(days=DEDUPE_DAYS), HotTopics.topic_date < today)
    )).scalars().all()
    urls = set()
    for row in rows:
        for it in json.loads(row.items or "[]"):
            if it.get("url"):
                urls.add(it["url"].lower())
    return urls


def _serialize(row: HotTopics) -> dict:
    return {
        "topic_date": row.topic_date.isoformat(),
        "items": json.loads(row.items) if row.items else [],
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def _get_row(db: AsyncSession, day) -> HotTopics | None:
    return (await db.execute(select(HotTopics).where(HotTopics.topic_date == day))).scalars().first()


async def _collect_items(db: AsyncSession) -> list:
    """
    新闻和 GitHub 各自失败都不影响另一边。DeepSeek 负责筛选和写中文摘要，它挑的不够名额时用原始结果补齐；
    DeepSeek 调用失败就直接按原始顺序各取名额数，保证两组都不会空着（只要搜到了东西）。
    返回的每条带 kind（news / github），前端按它分组。
    """
    exclude = await _recent_urls(db)
    repos = await _fetch_github_repos(exclude)
    news = await _fetch_ai_news(exclude)
    if not repos and not news:
        return []

    picked_news, picked_repos = [], []
    try:
        picked_news, picked_repos = await _compose_with_llm(repos, news)
    except Exception:
        logger.error("筛选 AI 热点失败，改用不筛选的原始结果", exc_info=True)

    news_by_url = {n["url"]: n for n in news}
    repo_by_url = {r["url"]: r for r in repos}
    news_items = [_news_item(news_by_url[p["url"]], p.get("summary"), p.get("title"))
                  for p in picked_news if p.get("url") in news_by_url][:NEWS_QUOTA]
    repo_items = [_repo_item(repo_by_url[p["url"]], p.get("summary"))
                  for p in picked_repos if p.get("url") in repo_by_url][:REPO_QUOTA]

    # 不够名额的用没选上的原始结果补齐
    used = {i["url"] for i in news_items + repo_items}
    news_items += [_news_item(n) for n in news if n["url"] not in used][:NEWS_QUOTA - len(news_items)]
    repo_items += [_repo_item(r) for r in repos if r["url"] not in used][:REPO_QUOTA - len(repo_items)]
    return news_items + repo_items


async def get_or_create_today_topics(db: AsyncSession) -> dict:
    """拿今天的热点列表，没有就现查一份存起来。"""
    today = clock.today()
    existing = await _get_row(db, today)
    if existing:
        return _serialize(existing)

    items = await _collect_items(db)
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
    items = await _collect_items(db)
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
