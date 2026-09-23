from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import reminders as reminders_service


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
]
