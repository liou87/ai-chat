from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import verify_api_key
from services import reminders as reminders_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


class CreateReminderRequest(BaseModel):
    message: str
    remind_at: datetime


@router.get("/reminders")
async def get_reminders():
    async with SessionLocal() as db:
        return await reminders_service.list_reminders(db)


@router.get("/reminders/due")
async def get_due_reminders():
    async with SessionLocal() as db:
        return await reminders_service.list_due(db)


@router.post("/reminders")
async def create_reminder(request: CreateReminderRequest):
    async with SessionLocal() as db:
        return await reminders_service.create_reminder(db, message=request.message, remind_at=request.remind_at)


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: int):
    async with SessionLocal() as db:
        ok = await reminders_service.cancel_reminder(db, reminder_id)
        if not ok:
            raise HTTPException(status_code=404, detail="提醒不存在")
        return {"deleted": True}
