from datetime import timedelta
import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Task, Note, Goal
from services.notes.notes import WEEKLY_REVIEW_PREFIX, RATING_LABELS
from services import clock

REVIEW_WINDOW_DAYS = 7


def _rating_averages(entries: list) -> dict:
    """日记四项评分（1-5）的周均值，只算这周真的打过分的天；没打过分的项不出现。"""
    totals = {}
    for n in entries:
        try:
            ratings = (json.loads(n.structured_data).get("ratings") or {}) if n.structured_data else {}
        except (ValueError, AttributeError):
            continue
        for key, value in ratings.items():
            if isinstance(value, (int, float)) and value:
                totals.setdefault(key, []).append(value)
    return {RATING_LABELS.get(k, k): {"avg": round(sum(v) / len(v), 1), "days": len(v)} for k, v in totals.items()}


async def get_weekly_review(db: AsyncSession) -> dict:
    """
    聚合近 7 天的任务完成情况 + 日记 + 新增笔记，返回结构化数据。
    这里只做数据聚合，不调用 LLM 生成总结——总结交给外层 agent 的自然语言回复，
    工具本身保持确定性、可测试。
    另外带上月目标/周目标的进度和日记评分的周均值，复盘才能对照用户自己定的目标说，而不只是数完成了几件事。
    """
    since = clock.now() - timedelta(days=REVIEW_WINDOW_DAYS)

    completed = await db.execute(
        select(Task).where(Task.done == True, Task.updated_at >= since)  # noqa: E712
        .order_by(Task.updated_at)
    )
    pending = await db.execute(
        select(Task).where(Task.done == False)  # noqa: E712
        .order_by(Task.created_at)
    )
    journal_entries = await db.execute(
        # 之前存下来的周复盘本身也是日记，不算进"这周写了什么日记"，免得复盘套复盘
        select(Note).where(Note.category == "journal", Note.created_at >= since,
                           Note.title.not_like(f"{WEEKLY_REVIEW_PREFIX}%"))
        .order_by(Note.created_at)
    )
    journal_entries = journal_entries.scalars().all()
    goals = await db.execute(
        # 还在进行的月目标、周目标，加上这周内完成的（复盘里值得提一句）
        select(Goal).where(Goal.tier.in_(("month", "week")),
                           (Goal.progress < 100) | (Goal.updated_at >= since))
        .order_by(Goal.tier, Goal.target_date)
    )
    new_notes = await db.execute(
        select(Note).where(Note.category == "note", Note.created_at >= since)
        .order_by(Note.created_at)
    )

    return {
        "period_from": since.strftime("%Y-%m-%d"),
        "period_to": clock.now().strftime("%Y-%m-%d"),
        "completed_tasks": [t.title for t in completed.scalars().all()],
        "pending_tasks": [t.title for t in pending.scalars().all()],
        "journal_entries": [
            {"date": n.created_at.strftime("%Y-%m-%d"), "content": n.content}
            for n in journal_entries
        ],
        "goals": [
            {"id": g.id, "tier": g.tier, "title": g.title, "progress": g.progress, "status": g.status,
             "target_date": g.target_date.strftime("%Y-%m-%d") if g.target_date else None}
            for g in goals.scalars().all()
        ],
        "journal_ratings_avg": _rating_averages(journal_entries),
        "new_notes": [n.title for n in new_notes.scalars().all()],
    }
