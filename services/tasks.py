from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Task
from services import clock


def _serialize(task: Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "done": task.done,
        "due_at": task.due_at.isoformat() if task.due_at else None,
        "goal_id": task.goal_id,
        "priority": task.priority,
        "estimate_minutes": task.estimate_minutes,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        # 完成状态变化时会更新这个时间，总览的"本周完成"按它近似判断是哪天完成的
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


PRIORITIES = ("high", "medium", "low")


def _clean_priority(value: Optional[str]) -> str:
    return value if value in PRIORITIES else "medium"


def _clean_minutes(value) -> Optional[int]:
    """预计时长：正整数分钟，别的一律当没填（agent 偶尔会传 0 或负数、字符串）。"""
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return None
    return minutes if minutes > 0 else None


async def create_task(db: AsyncSession, title: str, due_at: Optional[datetime] = None,
                       goal_id: Optional[int] = None, priority: Optional[str] = None,
                       estimate_minutes: Optional[int] = None) -> dict:
    task = Task(title=title, due_at=clock.to_local(due_at), goal_id=goal_id,
                priority=_clean_priority(priority), estimate_minutes=_clean_minutes(estimate_minutes))
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _serialize(task)


async def list_tasks(db: AsyncSession, status: str = "all") -> list[dict]:
    query = select(Task)
    if status == "pending":
        query = query.where(Task.done == False)  # noqa: E712
    elif status == "done":
        query = query.where(Task.done == True)  # noqa: E712
    query = query.order_by(Task.created_at.desc())
    result = await db.execute(query)
    return [_serialize(t) for t in result.scalars().all()]


async def complete_task(db: AsyncSession, task_id: int) -> Optional[dict]:
    task = await db.get(Task, task_id)
    if task is None:
        return None
    task.done = True
    task.updated_at = clock.now()
    await db.commit()
    await db.refresh(task)
    return _serialize(task)


# update_task 允许改的字段；没传的字段保持不变，传 None 表示清空（比如去掉截止时间、取消挂靠目标）
UPDATABLE_FIELDS = ("title", "done", "due_at", "goal_id", "priority", "estimate_minutes")


async def update_task(db: AsyncSession, task_id: int, changes: dict) -> Optional[dict]:
    task = await db.get(Task, task_id)
    if task is None:
        return None
    for field, value in changes.items():
        if field not in UPDATABLE_FIELDS:
            continue
        if field == "due_at":
            value = clock.to_local(value)
        if field == "title" and not (value or "").strip():
            continue  # 标题不允许改成空
        if field == "priority":
            value = _clean_priority(value)
        if field == "estimate_minutes":
            value = _clean_minutes(value)
        setattr(task, field, value)
    task.updated_at = clock.now()
    await db.commit()
    await db.refresh(task)
    return _serialize(task)


async def delete_task(db: AsyncSession, task_id: int) -> bool:
    task = await db.get(Task, task_id)
    if task is None:
        return False
    await db.delete(task)
    await db.commit()
    return True
