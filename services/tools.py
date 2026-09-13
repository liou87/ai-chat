from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import tasks as tasks_service
from services import notes as notes_service
from services import review as review_service
from services import reminders as reminders_service
from services import websearch as websearch_service


async def _create_task(db: AsyncSession, args: dict) -> dict:
    due_at = None
    if args.get("due_at"):
        try:
            due_at = datetime.fromisoformat(args["due_at"])
        except ValueError:
            due_at = None
    return await tasks_service.create_task(db, title=args["title"], due_at=due_at)


async def _list_tasks(db: AsyncSession, args: dict) -> dict:
    tasks = await tasks_service.list_tasks(db, status=args.get("status", "all"))
    return {"tasks": tasks}


async def _complete_task(db: AsyncSession, args: dict) -> dict:
    task = await tasks_service.complete_task(db, task_id=int(args["task_id"]))
    if task is None:
        return {"error": f"未找到 id 为 {args['task_id']} 的任务"}
    return task


async def _delete_task(db: AsyncSession, args: dict) -> dict:
    ok = await tasks_service.delete_task(db, task_id=int(args["task_id"]))
    return {"deleted": ok}


async def _save_note(db: AsyncSession, args: dict) -> dict:
    return await notes_service.create_note(
        db, title=args["title"], content=args["content"], category=args.get("category", "note")
    )


async def _search_notes(db: AsyncSession, args: dict) -> dict:
    results = await notes_service.search_notes(db, query=args["query"], top_k=args.get("top_k", 5))
    return {"notes": results}


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


async def _set_reminder(db: AsyncSession, args: dict) -> dict:
    try:
        remind_at = datetime.fromisoformat(args["remind_at"])
    except (KeyError, ValueError):
        return {"error": "remind_at 格式不对，需要 ISO 8601，例如 2026-09-20T18:00:00"}
    return await reminders_service.create_reminder(db, message=args["message"], remind_at=remind_at)


async def _list_reminders(db: AsyncSession, args: dict) -> dict:
    reminders = await reminders_service.list_reminders(db)
    return {"reminders": reminders}


async def _cancel_reminder(db: AsyncSession, args: dict) -> dict:
    ok = await reminders_service.cancel_reminder(db, reminder_id=int(args["reminder_id"]))
    return {"deleted": ok}


async def _web_search(db: AsyncSession, args: dict) -> dict:
    results = await websearch_service.web_search(args["query"], max_results=args.get("max_results", 5))
    return {"results": results}


# 每个工具：OpenAI/DeepSeek function calling 的 JSON Schema 定义 + 对应的异步处理函数
# handler 签名统一为 (db: AsyncSession, args: dict) -> dict，方便 agent 循环统一调度
TOOLS = [
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "create_task",
                "description": "创建一条新的任务/待办事项",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "任务内容"},
                        "due_at": {
                            "type": "string",
                            "description": "截止时间，ISO 8601 格式，例如 2026-09-20T18:00:00，不确定就留空",
                        },
                    },
                    "required": ["title"],
                },
            },
        },
        "handler": _create_task,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "list_tasks",
                "description": "查询任务列表",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "enum": ["all", "pending", "done"],
                            "description": "筛选条件：all=全部，pending=未完成，done=已完成",
                        },
                    },
                },
            },
        },
        "handler": _list_tasks,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "complete_task",
                "description": "把某个任务标记为已完成。如果不知道任务 id，先调用 list_tasks 查出来",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "integer", "description": "任务 id"},
                    },
                    "required": ["task_id"],
                },
            },
        },
        "handler": _complete_task,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "delete_task",
                "description": "删除某个任务。如果不知道任务 id，先调用 list_tasks 查出来",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "integer", "description": "任务 id"},
                    },
                    "required": ["task_id"],
                },
            },
        },
        "handler": _delete_task,
    },
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
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "set_reminder",
                "description": "设置一条日程提醒，到期后会在前端弹出提示",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "message": {"type": "string", "description": "提醒内容"},
                        "remind_at": {
                            "type": "string",
                            "description": "提醒时间，ISO 8601 格式，例如 2026-09-20T18:00:00",
                        },
                    },
                    "required": ["message", "remind_at"],
                },
            },
        },
        "handler": _set_reminder,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "list_reminders",
                "description": "查询所有设置过的提醒",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        "handler": _list_reminders,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "cancel_reminder",
                "description": "取消某条提醒。如果不知道 id，先调用 list_reminders 查出来",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reminder_id": {"type": "integer", "description": "提醒 id"},
                    },
                    "required": ["reminder_id"],
                },
            },
        },
        "handler": _cancel_reminder,
    },
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

TOOL_SCHEMAS = [t["schema"] for t in TOOLS]
TOOL_HANDLERS = {t["schema"]["function"]["name"]: t["handler"] for t in TOOLS}
