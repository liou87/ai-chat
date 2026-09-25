from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import verify_api_key
from services import tasks as tasks_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


class CreateTaskRequest(BaseModel):
    title: str
    due_at: Optional[datetime] = None
    goal_id: Optional[int] = None


@router.get("/tasks")
async def get_tasks(status: str = "all"):
    async with SessionLocal() as db:
        return await tasks_service.list_tasks(db, status=status)


@router.post("/tasks")
async def create_task(request: CreateTaskRequest):
    async with SessionLocal() as db:
        return await tasks_service.create_task(db, title=request.title, due_at=request.due_at, goal_id=request.goal_id)


@router.patch("/tasks/{task_id}/complete")
async def complete_task(task_id: int):
    async with SessionLocal() as db:
        task = await tasks_service.complete_task(db, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        return task


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int):
    async with SessionLocal() as db:
        ok = await tasks_service.delete_task(db, task_id)
        if not ok:
            raise HTTPException(status_code=404, detail="任务不存在")
        return {"deleted": True}
