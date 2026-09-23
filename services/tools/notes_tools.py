from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import notes as notes_service
from services import review as review_service
from services.notes import notion as notion_service


async def _save_note(db: AsyncSession, args: dict) -> dict:
    return await notes_service.create_note(
        db, title=args["title"], content=args["content"], category=args.get("category", "note")
    )


async def _search_notes(db: AsyncSession, args: dict) -> dict:
    results = await notes_service.search_notes(db, query=args["query"], top_k=args.get("top_k", 5))
    return {"notes": results}


async def _sync_notion_notes(db: AsyncSession, args: dict) -> dict:
    return await notion_service.sync_notion_notes(db)


async def _add_journal_entry(db: AsyncSession, args: dict) -> dict:
    entry_date = None
    if args.get("date"):
        try:
            entry_date = datetime.fromisoformat(args["date"])
        except ValueError:
            entry_date = None
    return await notes_service.create_journal_entry(db, content=args["content"], entry_date=entry_date)


async def _get_weekly_review(db: AsyncSession, args: dict) -> dict:
    return await review_service.get_weekly_review(db)


TOOLS = [
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "save_note",
                "description": "保存一条笔记到知识库，之后可以通过 search_notes 语义检索到",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "笔记标题"},
                        "content": {"type": "string", "description": "笔记正文"},
                    },
                    "required": ["title", "content"],
                },
            },
        },
        "handler": _save_note,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "search_notes",
                "description": "基于语义在笔记知识库里检索相关内容，用户问的问题可能答案就在过去记的笔记里",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "要检索的问题或关键词"},
                        "top_k": {"type": "integer", "description": "返回最相关的几条，默认 5"},
                    },
                    "required": ["query"],
                },
            },
        },
        "handler": _search_notes,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "sync_notion_notes",
                "description": "把用户 Notion 数据库里的页面同步到笔记库（只读导入，不会改动 Notion；"
                                "Notion 里已经删除的页面，本地副本也会删掉）。"
                                "用户说要同步/更新 Notion 笔记时用，返回新增、更新、跳过、失败、删除的数量",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        "handler": _sync_notion_notes,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "add_journal_entry",
                "description": "记一条日记/复盘条目",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "日记正文"},
                        "date": {
                            "type": "string",
                            "description": "这条日记对应的日期，ISO 8601 格式，例如 2026-09-14，不确定就留空（默认今天）",
                        },
                    },
                    "required": ["content"],
                },
            },
        },
        "handler": _add_journal_entry,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "get_weekly_review",
                "description": "获取近 7 天的任务完成情况、日记、新增笔记的聚合数据，用于生成周复盘总结",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        "handler": _get_weekly_review,
    },
]
