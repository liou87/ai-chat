"""
"让知行排一下今天"：把今天的待办按优先级、预计时长、截止时间排进剩下的时间里，生成一份时间表草稿。

草稿只返回不落库，用户在前端确认后再调 apply_plan 把计划开始时间写进任务。
排法交给 DeepSeek（它能权衡"难的放精力好的时段""截止早的先做"这类软规则），
但结果一律在这里再校验一遍：只认存在的待办、不早于现在、互不重叠、不排到深夜；DeepSeek 调用失败时退回简单的贪心排法。
"""
import json
import logging
from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Task, Reminder, Goal
from services import clock
from services.llm import get_client, MODEL_NAME

logger = logging.getLogger(__name__)

DEFAULT_MINUTES = 30        # 没填预计时长的任务按半小时排
DAY_END = (23, 0)           # 最晚排到 23:00 结束
NIGHT_UNTIL_HOUR = 6        # 凌晨这个点之前点"排一下"，不从现在开始排，而是从早上 DAY_START 开始（半夜排任务没意义）
DAY_START = (8, 0)
BREAK_MINUTES = 10          # 贪心兜底排法里两项之间留的休息时间
MAX_ITEMS = 6               # 一天最多排这么多项，排太满不现实
PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _round_up(dt: datetime, minutes: int = 15) -> datetime:
    """向上取整到 15 分钟，时间表从"下一个整刻钟"开始排，看起来更自然。"""
    dt = dt.replace(second=0, microsecond=0)
    extra = (-dt.minute) % minutes
    return dt + timedelta(minutes=extra)


async def _gather(db: AsyncSession) -> dict:
    now = clock.now()
    today_start = datetime(now.year, now.month, now.day)
    today_end = today_start + timedelta(days=1)
    pending = (await db.execute(select(Task).where(Task.done == False))).scalars().all()  # noqa: E712
    reminders = (await db.execute(
        select(Reminder).where(Reminder.remind_at >= now, Reminder.remind_at < today_end).order_by(Reminder.remind_at)
    )).scalars().all()
    goals = {g.id: g.title for g in (await db.execute(select(Goal))).scalars().all()}
    return {"now": now, "today_end": today_end, "pending": pending, "reminders": reminders, "goals": goals}


def _greedy(tasks: list, start: datetime, day_end: datetime) -> list:
    """兜底排法：高优先级、截止早的先排，一项接一项，中间留 10 分钟。"""
    ordered = sorted(tasks, key=lambda t: (PRIORITY_RANK.get(t.priority, 1), t.due_at or datetime.max))
    plan, cursor = [], start
    for t in ordered:
        minutes = t.estimate_minutes or DEFAULT_MINUTES
        end = cursor + timedelta(minutes=minutes)
        if end > day_end or len(plan) >= MAX_ITEMS:
            break
        plan.append({"task_id": t.id, "start": cursor})
        cursor = _round_up(end + timedelta(minutes=BREAK_MINUTES), 5)
    return plan


async def _ask_llm(ctx: dict, start: datetime, day_end: datetime) -> tuple[list, str]:
    now = ctx["now"]
    tasks = [{
        "task_id": t.id,
        "title": t.title,
        "priority": t.priority,
        "minutes": t.estimate_minutes or DEFAULT_MINUTES,
        "due": t.due_at.strftime("%m-%d %H:%M") if t.due_at else None,
        "goal": ctx["goals"].get(t.goal_id),
    } for t in ctx["pending"]]
    reminders = [{"time": r.remind_at.strftime("%H:%M"), "message": r.message} for r in ctx["reminders"]]
    prompt = (
        f"现在是 {now.strftime('%Y-%m-%d %H:%M')}（星期{'一二三四五六日'[now.weekday()]}）。"
        f"请把下面的待办排进今天剩下的时间：最早 {start.strftime('%H:%M')} 开始，最晚 {day_end.strftime('%H:%M')} 前结束。\n"
        "规则：每项用它的 minutes 作为时长；项与项之间留 5 到 15 分钟休息，不能重叠；"
        "高优先级、今天或已经过期截止的优先；需要专注的难任务尽量放在前面精力好的时段，零碎的小事放后面；"
        f"今天的提醒是固定时间点，尽量别让任务正好压在提醒时间上；最多排 {MAX_ITEMS} 项，排不下的就不排，不要排满到深夜。\n"
        'start 用 24 小时制 "HH:MM"。按 JSON 返回：{"plan": [{"task_id": 数字, "start": "HH:MM"}], '
        '"note": "一句话说明这样排的思路"}，note 里提到任务时用任务名，不要写 task_id 数字，不要输出别的内容。\n\n'
        f"待办：{json.dumps(tasks, ensure_ascii=False)}\n"
        f"今天剩下的提醒：{json.dumps(reminders, ensure_ascii=False)}\n"
    )
    response = await get_client().chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    plan = []
    for p in data.get("plan", []):
        try:
            h, m = map(int, str(p["start"]).split(":"))
            plan.append({"task_id": int(p["task_id"]), "start": now.replace(hour=h, minute=m, second=0, microsecond=0)})
        except (KeyError, ValueError, TypeError):
            continue
    return plan, (data.get("note") or "").strip()


def _validate(plan: list, tasks_by_id: dict, start: datetime, day_end: datetime) -> list:
    """只认存在的待办、每个任务只排一次；按开始时间排序，早于可排时间的往后挪，跟上一项重叠的顺延，超出一天的丢掉。"""
    seen, cleaned, cursor = set(), [], start
    for p in sorted(plan, key=lambda x: x["start"]):
        t = tasks_by_id.get(p["task_id"])
        if t is None or t.id in seen:
            continue
        begin = max(p["start"], cursor)
        end = begin + timedelta(minutes=t.estimate_minutes or DEFAULT_MINUTES)
        if end > day_end or len(cleaned) >= MAX_ITEMS:
            continue
        seen.add(t.id)
        cleaned.append({"task_id": t.id, "start": begin, "end": end})
        cursor = end
    return cleaned


async def suggest_today_plan(db: AsyncSession) -> dict:
    """生成今天的时间表草稿（不写库）。返回 {items: [{task_id, title, start, end, minutes}], note}。"""
    ctx = await _gather(db)
    now = ctx["now"]
    start = _round_up(now)
    if now.hour < NIGHT_UNTIL_HOUR:
        start = now.replace(hour=DAY_START[0], minute=DAY_START[1], second=0, microsecond=0)
    day_end = now.replace(hour=DAY_END[0], minute=DAY_END[1], second=0, microsecond=0)
    if not ctx["pending"] or start >= day_end:
        return {"items": [], "note": "今天没有待办可排了" if not ctx["pending"] else "今天已经很晚了，明天再排吧"}

    tasks_by_id = {t.id: t for t in ctx["pending"]}
    note = ""
    try:
        raw, note = await _ask_llm(ctx, start, day_end)
    except Exception:
        logger.error("让 DeepSeek 排今天失败，改用贪心排法", exc_info=True)
        raw = []
    plan = _validate(raw, tasks_by_id, start, day_end)
    if not plan:
        plan = _validate(_greedy(ctx["pending"], start, day_end), tasks_by_id, start, day_end)
        note = note or "按优先级和截止时间依次排的"

    return {
        "items": [{
            "task_id": p["task_id"],
            "title": tasks_by_id[p["task_id"]].title,
            "start": p["start"].isoformat(),
            "end": p["end"].isoformat(),
            "minutes": int((p["end"] - p["start"]).total_seconds() // 60),
        } for p in plan],
        "note": note,
    }


async def apply_plan(db: AsyncSession, items: list) -> int:
    """用户确认草稿后，把每项的开始时间写进对应任务的 planned_start。返回实际更新的条数。"""
    updated = 0
    for it in items:
        task = await db.get(Task, it["task_id"])
        if task is None or task.done:
            continue
        task.planned_start = clock.to_local(it["start"])
        task.updated_at = clock.now()
        updated += 1
    await db.commit()
    return updated
