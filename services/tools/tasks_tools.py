from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import tasks as tasks_service


async def _create_task(db: AsyncSession, args: dict) -> dict:
    due_at = None
    if args.get("due_at"):
        try:
            due_at = datetime.fromisoformat(args["due_at"])
        except ValueError:
            due_at = None
    return await tasks_service.create_task(db, title=args["title"], due_at=due_at, goal_id=args.get("goal_id"))


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
                        "goal_id": {
                            "type": "integer",
                            "description": "要挂靠的目标 id（可选）。不知道 id 就先调用 list_goals 查出来，"
                                            "用户没提目标就留空，不要凭空猜一个",
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
]
