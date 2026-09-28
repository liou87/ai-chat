from sqlalchemy.ext.asyncio import AsyncSession
from services import memory as memory_service
from services import library as library_service


async def _search_memory(db: AsyncSession, args: dict) -> dict:
    results = await memory_service.search_memory(
        db, query=args["query"], top_k=args.get("top_k", 5), exclude_session=args.get("_session_id")
    )
    return {"memories": results}


async def _save_link(db: AsyncSession, args: dict) -> dict:
    try:
        item = await library_service.add_url(db, url=args["url"], title=args.get("title"))
    except library_service.ImportError_ as e:
        return {"error": str(e)}
    return {"saved": True, "existed": item["existed"], "id": item["id"], "title": item["title"], "url": item["url"]}


TOOLS = [
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "search_memory",
                "description": "检索以前跟用户的对话记录（不含当前这次对话）。用户提到「上次说的」「我们之前聊过」「你还记得…吗」，"
                                "或者问题明显跟以前讨论过的事有关时用；返回相关的一问一答片段和日期",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "要回忆的内容，用关键词或问题描述"},
                        "top_k": {"type": "integer", "description": "返回几条，默认 5"},
                    },
                    "required": ["query"],
                },
            },
        },
        "handler": _search_memory,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "save_link",
                "description": "把一个网页链接或 GitHub 仓库收藏进资料库：抓取正文（仓库取 README）并建索引，之后 search_notes 能搜到。"
                                "用户说「把这个链接存下来」「收藏这篇」时用",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "完整网址，http:// 或 https:// 开头"},
                        "title": {"type": "string", "description": "标题（可选），不填就从网页里取"},
                    },
                    "required": ["url"],
                },
            },
        },
        "handler": _save_link,
    },
]
