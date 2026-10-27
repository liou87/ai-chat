from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import reminders as reminders_service
from services import confirm, clock
from database import Reminder


async def _set_reminder(db: AsyncSession, args: dict) -> dict:
    try:
        remind_at = datetime.fromisoformat(args["remind_at"])
    except (KeyError, ValueError):
        return {"error": "remind_at 格式不对，需要 ISO 8601，例如 2026-09-20T18:00:00"}
    return await reminders_service.create_reminder(db, message=args["message"], remind_at=remind_at)


async def _list_reminders(db: AsyncSession, args: dict) -> dict:
    reminders = await reminders_service.list_reminders(db)
    return {"reminders": reminders}


async def _update_reminder(db: AsyncSession, args: dict) -> dict:
    remind_at = None
    if args.get("remind_at"):
        try:
            remind_at = clock.to_local(datetime.fromisoformat(args["remind_at"]))
        except ValueError:
            return {"error": "remind_at 格式不对，需要 ISO 8601，例如 2026-09-20T18:00:00"}
        if remind_at <= clock.now():
            return {"error": "新的提醒时间已经过了，没有修改。先跟用户确认要改到什么时候"}
    if remind_at is None and not (args.get("message") or "").strip():
        return {"error": "没有要改的内容：remind_at 和 message 至少给一个"}
    reminder = await db.get(Reminder, int(args["reminder_id"]))
    if reminder is None:
        return {"error": f"未找到 id 为 {args['reminder_id']} 的提醒"}
    # 先记下旧值：同一个 session 里 service 拿到的是同一个对象，改完就看不到原来的了
    before = {"message": reminder.message, "remind_at": reminder.remind_at.isoformat() if reminder.remind_at else None}
    after = await reminders_service.update_reminder(db, reminder.id, message=args.get("message"), remind_at=remind_at)
    changed = {k: [before[k], after[k]] for k in before if before[k] != after[k]}
    return {"reminder": after, "changed": changed}


async def _cancel_reminder(db: AsyncSession, args: dict) -> dict:
    """不直接取消：返回待确认结果，前端弹确认卡片，用户确认后才执行（见 services/confirm.py）"""
    reminder = await db.get(Reminder, int(args["reminder_id"]))
    if reminder is None:
        return {"error": f"未找到 id 为 {args['reminder_id']} 的提醒"}
    return confirm.pending("cancel_reminder", reminder.id, reminder.message)


TOOLS = [
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
                            "description": "提醒时间，ISO 8601 格式，例如 2026-09-20T18:00:00。必须是用户给出的具体时刻："
                                            "只说了日期（明天、周五）没说几点时不要自己定一个，先问用户几点",
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
                "name": "update_reminder",
                "description": "修改已有提醒的时间或内容（原地修改，不要用 set_reminder 另建一条）。"
                                "用户说「改成 9 点」「推迟到明天」「提前半小时」时用。如果不知道 id，先调用 list_reminders 查出来",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reminder_id": {"type": "integer", "description": "提醒 id"},
                        "remind_at": {
                            "type": "string",
                            "description": "新的提醒时间，ISO 8601，例如 2026-09-20T09:00:00。用户只说了几点时沿用原来的日期，"
                                            "说「提前/推迟多久」时在原时间上加减",
                        },
                        "message": {"type": "string", "description": "新的提醒内容，用户要改内容时才填"},
                    },
                    "required": ["reminder_id"],
                },
            },
        },
        "handler": _update_reminder,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "cancel_reminder",
                "description": "取消某条提醒（需要用户在聊天里点确认后才会真正执行）。如果不知道 id，先调用 list_reminders 查出来",
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
]
