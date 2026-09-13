from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Task, Note

REVIEW_WINDOW_DAYS = 7


async def get_weekly_review(db: AsyncSession) -> dict:
    """
    聚合近 7 天的任务完成情况 + 日记 + 新增笔记，返回结构化数据。
    这里只做数据聚合，不调用 LLM 生成总结——总结交给外层 agent 的自然语言回复，
    工具本身保持确定性、可测试。
    """
    since = datetime.now() - timedelta(days=REVIEW_WINDOW_DAYS)

    completed = await db.execute(
        select(Task).where(Task.done == True, Task.updated_at >= since)  # noqa: E712
        .order_by(Task.updated_at)
    )
    pending = await db.execute(
        select(Task).where(Task.done == False)  # noqa: E712
        .order_by(Task.created_at)
    )
    journal_entries = await db.execute(
        select(Note).where(Note.category == "journal", Note.created_at >= since)
        .order_by(Note.created_at)
    )
    new_notes = await db.execute(
        select(Note).where(Note.category == "note", Note.created_at >= since)
        .order_by(Note.created_at)
    )

    return {
        "period_from": since.strftime("%Y-%m-%d"),
        "period_to": datetime.now().strftime("%Y-%m-%d"),
        "completed_tasks": [t.title for t in completed.scalars().all()],
        "pending_tasks": [t.title for t in pending.scalars().all()],
        "journal_entries": [
            {"date": n.created_at.strftime("%Y-%m-%d"), "content": n.content}
            for n in journal_entries.scalars().all()
        ],
        "new_notes": [n.title for n in new_notes.scalars().all()],
    }
