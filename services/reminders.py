from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Reminder
from services import clock


def _serialize(r: Reminder) -> dict:
    return {
        "id": r.id,
        "message": r.message,
        "remind_at": r.remind_at.isoformat() if r.remind_at else None,
        "fired": r.fired,
        "acknowledged": r.acknowledged,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def create_reminder(db: AsyncSession, message: str, remind_at: datetime) -> dict:
    reminder = Reminder(message=message, remind_at=clock.to_local(remind_at))
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)
    return _serialize(reminder)


async def list_reminders(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(Reminder).order_by(Reminder.remind_at))
    return [_serialize(r) for r in result.scalars().all()]


async def list_due(db: AsyncSession) -> list[dict]:
    """到期（已被后台任务标记 fired）且用户还没点"知道了"的提醒，前端据此弹提示条。"""
    result = await db.execute(
        select(Reminder).where(Reminder.fired == True, Reminder.acknowledged == False)  # noqa: E712
        .order_by(Reminder.remind_at)
    )
    return [_serialize(r) for r in result.scalars().all()]


async def acknowledge_reminder(db: AsyncSession, reminder_id: int) -> Optional[dict]:
    """用户点了"知道了"：条幅不再出现，提醒本身留着，在提醒页的"已读"分组里还能看到。"""
    r = await db.get(Reminder, reminder_id)
    if r is None:
        return None
    r.acknowledged = True
    await db.commit()
    await db.refresh(r)
    return _serialize(r)


async def cancel_reminder(db: AsyncSession, reminder_id: int) -> bool:
    r = await db.get(Reminder, reminder_id)
    if r is None:
        return False
    await db.delete(r)
    await db.commit()
    return True


async def mark_due_as_fired(db: AsyncSession) -> list[dict]:
    """后台调度任务调用：把到期但还没标记的提醒置为 fired，返回新触发的这批。"""
    now = clock.now()
    result = await db.execute(select(Reminder).where(Reminder.remind_at <= now, Reminder.fired == False))  # noqa: E712
    due = result.scalars().all()
    for r in due:
        r.fired = True
    if due:
        await db.commit()
    return [_serialize(r) for r in due]
