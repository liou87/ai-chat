import os
import logging
import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
TAVILY_URL = "https://api.tavily.com/search"

if not TAVILY_API_KEY:
    logger.warning("未设置 TAVILY_API_KEY，web_search 工具会返回错误提示而不是崩溃")


async def web_search(query: str, max_results: int = 5) -> list:
    if not TAVILY_API_KEY:
        return [{"error": "联网搜索未配置（缺少 TAVILY_API_KEY），无法执行这次搜索"}]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(TAVILY_URL, json={
                "api_key": TAVILY_API_KEY,
                "query": query,
                "max_results": max_results,
            })
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        logger.error(f"联网搜索失败：{query}", exc_info=True)
        return [{"error": "联网搜索请求失败，请稍后再试"}]

    return [
        {"title": r.get("title"), "url": r.get("url"), "content": r.get("content")}
        for r in data.get("results", [])
    ]
