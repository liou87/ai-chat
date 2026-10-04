"""
评测时替换掉的外部工具：联网搜索、读网页、收藏链接、同步 Notion。

数据库里的工具（任务、提醒、记忆、笔记检索……）都真实执行，只是写在 eval schema 里；
这几个要访问外网的换成固定返回：结果不随网络和日期变化，也不花 Tavily 额度。
评测关心的是知行"调没调、参数对不对、拿到结果后怎么回答"，不是外部服务本身。
"""
from sqlalchemy.ext.asyncio import AsyncSession

MOCKED_TOOLS = ("web_search", "read_url", "save_link", "sync_notion_notes")


async def _web_search(db: AsyncSession, args: dict) -> dict:
    query = args.get("query", "")
    return {"results": [
        {"title": f"{query} - 最新消息", "url": "https://example.com/search/1",
         "content": f"关于「{query}」的最新报道：相关公司本周发布了新版本，重点提升了推理和工具调用能力。",
         "published_date": "2026-10-05"},
        {"title": f"{query} 深度解读", "url": "https://example.com/search/2",
         "content": "业内分析认为，这次更新的关键在于长上下文和 agent 场景的稳定性。",
         "published_date": "2026-10-04"},
    ]}


PAGES = {
    "https://example.com/news/rrsi": (
        "Google Research open-sources RRSI",
        "RRSI 让 LLM agent 在不修改模型权重的前提下改进自己的 harness：提示词、工具、记忆、控制流。"
        "为防止自我改进过拟合评测集，它引入了编辑预算退火、编辑账本、泄漏检测和成本约束。"
        "在 Terminal-Bench 上从 74.2% 提升到 80.2%，在未参与选择的 SWE-bench Verified 上也有提升。"
        "代码以 Apache 2.0 开源，支持任意 LiteLLM 模型。"),
}


async def _read_url(db: AsyncSession, args: dict) -> dict:
    url = args.get("url", "").strip()
    title, content = PAGES.get(url, ("示例页面", f"这是 {url} 的正文。页面介绍了一个开源项目的用途、安装方式和示例。"))
    return {"title": title, "url": url, "content": content, "truncated": False, "total_chars": len(content)}


async def _save_link(db: AsyncSession, args: dict) -> dict:
    return {"saved": True, "existed": False, "id": 999, "title": args.get("title") or "示例页面", "url": args.get("url")}


async def _sync_notion_notes(db: AsyncSession, args: dict) -> dict:
    return {"created": 0, "updated": 0, "skipped": 3}


HANDLERS = {
    "web_search": _web_search,
    "read_url": _read_url,
    "save_link": _save_link,
    "sync_notion_notes": _sync_notion_notes,
}


def install() -> None:
    """把注册表里的外部工具换成假的。services/agent.py 按名字从 TOOL_HANDLERS 取，直接改这个字典就行。"""
    from services.tools import TOOL_HANDLERS
    for name, handler in HANDLERS.items():
        TOOL_HANDLERS[name] = handler
