from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import tasks as tasks_service
from services import notes as notes_service


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
]

TOOL_SCHEMAS = [t["schema"] for t in TOOLS]
TOOL_HANDLERS = {t["schema"]["function"]["name"]: t["handler"] for t in TOOLS}
