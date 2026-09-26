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
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }


async def create_task(db: AsyncSession, title: str, due_at: Optional[datetime] = None,
                       goal_id: Optional[int] = None) -> dict:
    task = Task(title=title, due_at=clock.to_local(due_at), goal_id=goal_id)
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
UPDATABLE_FIELDS = ("title", "done", "due_at", "goal_id")


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
