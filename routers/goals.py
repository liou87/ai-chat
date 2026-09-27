from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import verify_api_key
from services import goals as goals_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


class CreateGoalRequest(BaseModel):
    title: str
    tier: str
    parent_id: Optional[int] = None
    description: Optional[str] = None
    target_date: Optional[datetime] = None
    status: Optional[str] = None


class UpdateGoalProgressRequest(BaseModel):
    progress: int
    status: Optional[str] = None


class UpdateGoalRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None             # 自由文本，比如"正常""轻度迟缓"；传空字符串表示清空
    target_date: Optional[datetime] = None   # 截止日期，总览页用来做倒计时；传 null 表示清空，不传表示不动


@router.get("/goals")
async def get_goals(tier: Optional[str] = None):
    async with SessionLocal() as db:
        return await goals_service.list_goals(db, tier=tier)


@router.post("/goals")
async def create_goal(request: CreateGoalRequest):
    async with SessionLocal() as db:
        try:
            return await goals_service.create_goal(
                db, title=request.title, tier=request.tier, parent_id=request.parent_id,
                description=request.description, target_date=request.target_date, status=request.status,
            )
        except goals_service.InvalidGoalHierarchy as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.patch("/goals/{goal_id}/progress")
async def update_goal_progress(goal_id: int, request: UpdateGoalProgressRequest):
    async with SessionLocal() as db:
        goal = await goals_service.update_goal_progress(db, goal_id, request.progress, request.status)
        if goal is None:
            raise HTTPException(status_code=404, detail="目标不存在")
        return goal


@router.patch("/goals/{goal_id}")
async def update_goal(goal_id: int, request: UpdateGoalRequest):
    async with SessionLocal() as db:
        extra = {"target_date": request.target_date} if "target_date" in request.model_fields_set else {}
        goal = await goals_service.update_goal(db, goal_id, title=request.title, description=request.description,
                                               status=request.status, **extra)
        if goal is None:
            raise HTTPException(status_code=404, detail="目标不存在")
        return goal


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: int):
    async with SessionLocal() as db:
        ok = await goals_service.delete_goal(db, goal_id)
        if not ok:
            raise HTTPException(status_code=404, detail="目标不存在")
        return {"deleted": True}
