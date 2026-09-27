from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Goal
from services import clock

TIERS = ("phase", "month", "week")
# 上级目标的层级要求：phase 没有上级；month 可以挂在某个 phase 下，week 可以挂在某个 month 下。
# 上级是可选的——不是每个周目标都属于某个更大的计划，强制先建阶段目标再建月目标，门槛太高
PARENT_TIER = {"phase": None, "month": "phase", "week": "month"}


class InvalidGoalHierarchy(Exception):
    """目标层级不对，比如给 week 挂了一个 phase 当上级。"""


def _serialize(goal: Goal) -> dict:
    return {
        "id": goal.id,
        "parent_id": goal.parent_id,
        "tier": goal.tier,
        "title": goal.title,
        "description": goal.description,
        "target_date": goal.target_date.isoformat() if goal.target_date else None,
        "progress": goal.progress,
        "status": goal.status,
        "created_at": goal.created_at.isoformat() if goal.created_at else None,
    }


async def create_goal(db: AsyncSession, title: str, tier: str, parent_id: Optional[int] = None,
                       description: Optional[str] = None, target_date: Optional[datetime] = None,
                       status: Optional[str] = None) -> dict:
    if tier not in TIERS:
        raise InvalidGoalHierarchy(f"tier 必须是 {TIERS} 之一")

    expected_parent_tier = PARENT_TIER[tier]
    if expected_parent_tier is None:
        parent_id = None  # phase 不允许有上级，传了也忽略
    elif parent_id is not None:
        # 不挂上级可以；挂的话层级得对得上
        parent = await db.get(Goal, parent_id)
        if parent is None or parent.tier != expected_parent_tier:
            raise InvalidGoalHierarchy(f"{tier} 的上级目标必须是 {expected_parent_tier} 类型")

    goal = Goal(title=title, tier=tier, parent_id=parent_id, description=description,
                target_date=target_date, status=status)
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return _serialize(goal)


async def list_goals(db: AsyncSession, tier: Optional[str] = None) -> list[dict]:
    query = select(Goal)
    if tier:
        query = query.where(Goal.tier == tier)
    query = query.order_by(Goal.tier, Goal.created_at)
    result = await db.execute(query)
    return [_serialize(g) for g in result.scalars().all()]


async def update_goal_progress(db: AsyncSession, goal_id: int, progress: int,
                                status: Optional[str] = None) -> Optional[dict]:
    goal = await db.get(Goal, goal_id)
    if goal is None:
        return None
    goal.progress = max(0, min(100, progress))
    if status is not None:
        goal.status = status
    goal.updated_at = clock.now()
    await db.commit()
    await db.refresh(goal)
    return _serialize(goal)


async def update_goal(db: AsyncSession, goal_id: int, title: Optional[str] = None,
                       description: Optional[str] = None) -> Optional[dict]:
    """改标题/说明；层级和上级不允许在这里改，挪层级牵扯子目标，真要改就删了重建。"""
    goal = await db.get(Goal, goal_id)
    if goal is None:
        return None
    if title is not None and title.strip():
        goal.title = title.strip()
    if description is not None:
        goal.description = description.strip() or None
    goal.updated_at = clock.now()
    await db.commit()
    await db.refresh(goal)
    return _serialize(goal)


async def delete_goal(db: AsyncSession, goal_id: int) -> bool:
    # 子目标靠 goals.parent_id 的外键级联删除；挂在这个目标下的任务外键是 SET NULL，不会被删掉
    goal = await db.get(Goal, goal_id)
    if goal is None:
        return False
    await db.delete(goal)
    await db.commit()
    return True
