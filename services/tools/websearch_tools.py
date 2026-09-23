from sqlalchemy.ext.asyncio import AsyncSession
from services import websearch as websearch_service


async def _web_search(db: AsyncSession, args: dict) -> dict:
    results = await websearch_service.web_search(args["query"], max_results=args.get("max_results", 5))
    return {"results": results}


TOOLS = [
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "联网搜索最新信息。只有当问题涉及实时/最新内容（新闻、版本号、价格等），"
                                "且不是笔记库里能查到的个人信息时才用这个",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "搜索关键词"},
                        "max_results": {"type": "integer", "description": "返回结果数，默认 5"},
                    },
                    "required": ["query"],
                },
            },
        },
        "handler": _web_search,
    },
]
