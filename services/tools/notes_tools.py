from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import notes as notes_service
from services import review as review_service
from services.notes import notion as notion_service


async def _save_note(db: AsyncSession, args: dict) -> dict:
    return await notes_service.create_note(
        db, title=args["title"], content=args["content"], category=args.get("category", "note")
    )


# 来源的中文名，给模型和前端引用标签用
SOURCE_LABEL = {"local": "笔记", "notion": "Notion", "hot_topic": "热点收藏", "web": "网页", "github": "GitHub", "pdf": "PDF"}


async def _search_notes(db: AsyncSession, args: dict) -> dict:
    """
    搜笔记、日记和资料库。只把命中的那一段（snippet）给模型，不给全文：资料库里一篇文章可能几万字，
    全文塞进上下文会撑爆。前端的"参考了哪些资料"标签也用这里返回的 id/title/url/来源。
    """
    results = await notes_service.search_notes(db, query=args["query"], top_k=args.get("top_k", 5))
    return {"notes": [{
        "id": n["id"],
        "title": n["title"],
        "category": n["category"],
        "source": SOURCE_LABEL.get(n["source"], n["source"]) if n["category"] != "journal" else "日记",
        "url": n.get("url"),
        "snippet": n["snippet"],
        "score": n.get("score"),
    } for n in results]}


async def _sync_notion_notes(db: AsyncSession, args: dict) -> dict:
    return await notion_service.sync_notion_notes(db)


RATING_FIELDS = ("energy", "stress", "satisfaction", "focus")


async def _add_journal_entry(db: AsyncSession, args: dict) -> dict:
    entry_date = None
    if args.get("date"):
        try:
            entry_date = datetime.fromisoformat(args["date"])
        except ValueError:
            entry_date = None

    # 引导问答/评分任意一项出现，就当成结构化复盘处理，正文交给 create_journal_entry 自动渲染；
    # 都没有的话就是纯自由文本日记，走原来的路径
    answer_keys = ("done", "blocker", "tomorrow")
    structured_data = None
    if any(args.get(k) for k in answer_keys) or any(args.get(k) is not None for k in RATING_FIELDS):
        structured_data = {
            "answers": {k: args[k] for k in answer_keys if args.get(k)},
            "ratings": {k: args[k] for k in RATING_FIELDS if args.get(k) is not None},
            "notes": args.get("content"),
        }

    return await notes_service.create_journal_entry(
        db, content=args.get("content", ""), entry_date=entry_date, structured_data=structured_data
    )


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
                "description": "基于语义检索知识库：用户自己的笔记、日记，以及资料库里收藏的文章、GitHub 仓库、网页和 PDF。"
                                "用户问的问题可能答案就在这些资料里；返回命中的片段和出处",
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
                "description": "记一条日记/复盘条目。用户如果是在做每日复盘（回顾今天做了什么、遇到的问题、"
                                "明天打算做什么，或者提到精力/压力/心情这类状态），优先用 done/blocker/tomorrow/"
                                "energy/stress/satisfaction/focus 这几个引导字段分别填，不要把回答揉进 content 里；"
                                "content 只用于纯自由记录，两种可以同时给。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "自由记录的正文，不属于下面几个引导问题的内容写这里，不确定就留空"},
                        "done": {"type": "string", "description": "今天完成了什么"},
                        "blocker": {"type": "string", "description": "今天最大的阻碍是什么"},
                        "tomorrow": {"type": "string", "description": "明天最重要的一件事"},
                        "energy": {"type": "integer", "description": "精力评分，1 到 5"},
                        "stress": {"type": "integer", "description": "压力评分，1 到 5"},
                        "satisfaction": {"type": "integer", "description": "满意度评分，1 到 5"},
                        "focus": {"type": "integer", "description": "专注度评分，1 到 5"},
                        "date": {
                            "type": "string",
                            "description": "这条日记对应的日期，ISO 8601 格式，例如 2026-09-14，不确定就留空（默认今天）",
                        },
                    },
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
