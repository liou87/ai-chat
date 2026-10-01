from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from services.auth import require_auth
from services import schedule as schedule_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(require_auth)])


class PlanItem(BaseModel):
    task_id: int
    start: datetime


class ApplyPlanRequest(BaseModel):
    items: List[PlanItem]


# 生成今天的时间表草稿，不写库；前端展示给用户确认
@router.post("/schedule/today/suggest")
async def suggest_today():
    async with SessionLocal() as db:
        return await schedule_service.suggest_today_plan(db)


# 用户确认草稿后，把计划开始时间写进任务
@router.post("/schedule/today/apply")
async def apply_today(request: ApplyPlanRequest):
    async with SessionLocal() as db:
        updated = await schedule_service.apply_plan(db, [i.model_dump() for i in request.items])
        return {"updated": updated}
