from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import require_auth
from services import reminders as reminders_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(require_auth)])


class CreateReminderRequest(BaseModel):
    message: str
    remind_at: datetime


# 查询前先把已经到点的提醒标记为 fired：部署在 Vercel 上没有常驻的定时任务，
# 靠前端每 20 秒轮询 /reminders/due 顺手完成到期检查；本地常驻进程里调度器也在做同样的事，重复标记没有副作用
@router.get("/reminders")
async def get_reminders():
    async with SessionLocal() as db:
        await reminders_service.mark_due_as_fired(db)
        return await reminders_service.list_reminders(db)


@router.get("/reminders/due")
async def get_due_reminders():
    async with SessionLocal() as db:
        await reminders_service.mark_due_as_fired(db)
        return await reminders_service.list_due(db)


@router.post("/reminders")
async def create_reminder(request: CreateReminderRequest):
    async with SessionLocal() as db:
        return await reminders_service.create_reminder(db, message=request.message, remind_at=request.remind_at)


@router.patch("/reminders/{reminder_id}/acknowledge")
async def acknowledge_reminder(reminder_id: int):
    async with SessionLocal() as db:
        r = await reminders_service.acknowledge_reminder(db, reminder_id)
        if r is None:
            raise HTTPException(status_code=404, detail="提醒不存在")
        return r


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: int):
    async with SessionLocal() as db:
        ok = await reminders_service.cancel_reminder(db, reminder_id)
        if not ok:
            raise HTTPException(status_code=404, detail="提醒不存在")
        return {"deleted": True}
