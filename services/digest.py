from datetime import datetime, timedelta
import logging
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from database import Task, Reminder, DailyDigest
from services import persona, clock
from services.llm import get_client, MODEL_NAME

logger = logging.getLogger(__name__)


async def _aggregate_today(db: AsyncSession) -> dict:
    """今天到期/已过期的任务，今天的提醒；还没定日期的待办只给个数，不逐条列，避免简报太长。"""
    now = clock.now()
    today_start = datetime(now.year, now.month, now.day)
    today_end = today_start + timedelta(days=1)

    due = (await db.execute(
        select(Task).where(Task.done == False, Task.due_at.isnot(None), Task.due_at < today_end)  # noqa: E712
        .order_by(Task.due_at)
    )).scalars().all()
    undated_pending = (await db.execute(
        select(Task).where(Task.done == False, Task.due_at.is_(None))  # noqa: E712
    )).scalars().all()
    todays_reminders = (await db.execute(
        select(Reminder).where(Reminder.fired == False, Reminder.remind_at >= today_start,  # noqa: E712
                                Reminder.remind_at < today_end)
        .order_by(Reminder.remind_at)
    )).scalars().all()

    return {
        "due_or_overdue_tasks": [
            {"title": t.title, "due_at": t.due_at.strftime("%Y-%m-%d %H:%M"), "overdue": t.due_at < now}
            for t in due
        ],
        "undated_pending_count": len(undated_pending),
        "todays_reminders": [
            {"message": r.message, "remind_at": r.remind_at.strftime("%H:%M")}
            for r in todays_reminders
        ],
    }


def _fallback_text(data: dict) -> str:
    """DeepSeek 调用失败时的兜底文案，纯模板拼接，不依赖模型，保证卡片不会因为一次 API 失败就空着。"""
    parts = []
    if data["due_or_overdue_tasks"]:
        parts.append(f"{len(data['due_or_overdue_tasks'])} 项任务今天到期或已经过期")
    if data["todays_reminders"]:
        parts.append(f"{len(data['todays_reminders'])} 条提醒在今天")
    if not parts:
        return f"今天没有到期的任务或提醒，安排得挺松快，有需要随时叫我。"
    return f"今天{'，'.join(parts)}，我把清单列在下面，别漏了。"


async def _compose_with_llm(data: dict) -> str:
    now = clock.now()
    prompt = (
        f"{persona.IDENTITY}\n"
        f"现在是 {now.strftime('%Y-%m-%d %H:%M')}，请你用第一人称给用户写一份简短的「今日简报」，"
        "开头像日常打招呼一样自然，不要用「亲爱的用户」这种客套话，也不要提「简报」这个词本身。"
        "内容只讲下面数据里实际有的事，不要编造没提到的任务或安排；"
        "如果数据是空的，就用轻松的语气说今天没什么安排。控制在 3 句话以内，不分点、不用 markdown。\n\n"
        f"今天到期或已过期的任务：{data['due_or_overdue_tasks'] or '无'}\n"
        f"还没定日期、仍未完成的任务数：{data['undated_pending_count']}\n"
        f"今天的提醒：{data['todays_reminders'] or '无'}\n"
    )
    response = await get_client().chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()


def _serialize(digest: DailyDigest) -> dict:
    return {
        "digest_date": digest.digest_date.isoformat(),
        "content": digest.content,
        "created_at": digest.created_at.isoformat() if digest.created_at else None,
    }


async def _compose(db: AsyncSession) -> str:
    data = await _aggregate_today(db)
    try:
        return await _compose_with_llm(data)
    except Exception:
        logger.error("生成每日简报失败，改用模板兜底", exc_info=True)
        return _fallback_text(data)


async def regenerate_today_digest(db: AsyncSession) -> dict:
    """用户手动点"重新生成"：按现在的任务/提醒重新写一份，覆盖今天那条。"""
    today = clock.today()
    content = await _compose(db)
    digest = (await db.execute(select(DailyDigest).where(DailyDigest.digest_date == today))).scalars().first()
    if digest is None:
        digest = DailyDigest(digest_date=today)
        db.add(digest)
    digest.content = content
    digest.created_at = clock.now()
    await db.commit()
    await db.refresh(digest)
    return _serialize(digest)


async def get_or_create_today_digest(db: AsyncSession) -> dict:
    """
    拿今天的简报，没有就现算一份存起来：一天只会真正生成一次，重复调用（比如用户刷新页面）
    都是直接读库。调 LLM 失败时退化成模板文案，不让整张卡片因为一次 API 失败就空着。
    """
    today = clock.today()
    existing = (await db.execute(select(DailyDigest).where(DailyDigest.digest_date == today))).scalars().first()
    if existing:
        return _serialize(existing)

    content = await _compose(db)
    digest = DailyDigest(digest_date=today, content=content)
    try:
        db.add(digest)
        await db.commit()
    except IntegrityError:
        # 极小概率的竞态：调度任务和用户开页面几乎同时触发，谁先提交都行，读已经存在的那条就行
        await db.rollback()
        existing = (await db.execute(select(DailyDigest).where(DailyDigest.digest_date == today))).scalars().first()
        return _serialize(existing)

    await db.refresh(digest)
    return _serialize(digest)
