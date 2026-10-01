from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from services import hot_topics as hot_topics_service
from services import library as library_service

# 临时读原文只给模型这么多字：够分析一篇文章/README 的主体，又不至于一次塞进几万字把上下文和 token 撑爆
READ_MAX_CHARS = 12000


async def _get_hot_topics(db: AsyncSession, args: dict) -> dict:
    day = args.get("date")
    if day:
        try:
            parsed = date.fromisoformat(day)
        except ValueError:
            return {"error": f"日期格式不对：{day}，要 YYYY-MM-DD"}
        data = await hot_topics_service.get_topics_by_date(db, parsed)
        if data is None:
            return {"error": f"{day} 没有热点记录"}
    else:
        # 今天的还没生成会现查一份（跟打开热点页一样），要等十几秒
        data = await hot_topics_service.get_or_create_today_topics(db)
    return {"date": data["topic_date"], "items": data["items"]}


async def _read_url(db: AsyncSession, args: dict) -> dict:
    try:
        fetched = await library_service.fetch_url(args["url"])
    except library_service.ImportError_ as e:
        return {"error": str(e)}
    content = fetched["content"]
    return {
        "title": fetched["title"],
        "url": args["url"].strip(),
        "content": content[:READ_MAX_CHARS],
        "truncated": len(content) > READ_MAX_CHARS,
        "total_chars": len(content),
    }


TOOLS = [
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "get_hot_topics",
                "description": "拿每日 AI 热点列表（最新消息 + GitHub 新项目），每条有标题、链接、一句话摘要、来源。"
                                "用户问今天/某天的热点、哪个值得看、想让你挑几条分析时用",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "date": {"type": "string", "description": "YYYY-MM-DD，不填就是今天"},
                    },
                },
            },
        },
        "handler": _get_hot_topics,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "read_url",
                "description": "临时读一个网页或 GitHub 仓库的正文（仓库读 README），只用于这次回答，不会存进资料库。"
                                "要分析某条热点或用户给的链接、摘要信息不够时用；用户想长期保存才用 save_link",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "完整网址，http:// 或 https:// 开头"},
                    },
                    "required": ["url"],
                },
            },
        },
        "handler": _read_url,
    },
]
