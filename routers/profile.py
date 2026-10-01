from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import verify_api_key
from services import profile as profile_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


class FactRequest(BaseModel):
    category: str
    content: str


class UpdateFactRequest(BaseModel):
    category: Optional[str] = None
    content: Optional[str] = None


@router.get("/profile")
async def list_facts():
    async with SessionLocal() as db:
        return await profile_service.list_facts(db)


@router.post("/profile")
async def add_fact(request: FactRequest):
    async with SessionLocal() as db:
        try:
            return await profile_service.add_fact(db, request.category, request.content, source="user")
        except profile_service.ProfileError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.patch("/profile/{fact_id}")
async def update_fact(fact_id: int, request: UpdateFactRequest):
    async with SessionLocal() as db:
        try:
            fact = await profile_service.update_fact(db, fact_id, content=request.content, category=request.category)
        except profile_service.ProfileError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if fact is None:
            raise HTTPException(status_code=404, detail="这条记忆不存在")
        return fact


@router.delete("/profile/{fact_id}")
async def delete_fact(fact_id: int):
    async with SessionLocal() as db:
        if not await profile_service.delete_fact(db, fact_id):
            raise HTTPException(status_code=404, detail="这条记忆不存在")
        return {"deleted": True}
