from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import tasks as tasks_service
from services import confirm
from database import Task


def _parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _create_task(db: AsyncSession, args: dict) -> dict:
    due_at = None
    if args.get("due_at"):
        try:
            due_at = datetime.fromisoformat(args["due_at"])
        except ValueError:
            due_at = None
    return await tasks_service.create_task(db, title=args["title"], due_at=due_at, goal_id=args.get("goal_id"),
                                           priority=args.get("priority"), estimate_minutes=args.get("estimate_minutes"),
                                           planned_start=_parse_time(args.get("planned_start")))


async def _list_tasks(db: AsyncSession, args: dict) -> dict:
    tasks = await tasks_service.list_tasks(db, status=args.get("status", "all"))
    return {"tasks": tasks}


async def _complete_task(db: AsyncSession, args: dict) -> dict:
    task = await tasks_service.complete_task(db, task_id=int(args["task_id"]))
    if task is None:
        return {"error": f"未找到 id 为 {args['task_id']} 的任务"}
    return task


async def _delete_task(db: AsyncSession, args: dict) -> dict:
    """不直接删：返回待确认结果，前端弹确认卡片，用户确认后才执行（见 services/confirm.py）"""
    task = await db.get(Task, int(args["task_id"]))
    if task is None:
        return {"error": f"未找到 id 为 {args['task_id']} 的任务"}
    return confirm.pending("delete_task", task.id, task.title)


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
                        "priority": {
                            "type": "string", "enum": ["high", "medium", "low"],
                            "description": "优先级，用户说了重要/紧急就填 high，说了不急就填 low，没提就留空（默认 medium）",
                        },
                        "estimate_minutes": {
                            "type": "integer",
                            "description": "预计要花多少分钟（可选），用户提到大概要多久时换算成分钟，没提就留空",
                        },
                        "planned_start": {
                            "type": "string",
                            "description": "计划几点开始做（可选），ISO 8601，例如 2026-09-29T14:00:00。"
                                            "用户说了「下午两点做」这类具体时间才填，跟截止时间 due_at 不是一回事",
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
                "description": "删除某个任务（需要用户在聊天里点确认后才会真正执行）。如果不知道任务 id，先调用 list_tasks 查出来",
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
