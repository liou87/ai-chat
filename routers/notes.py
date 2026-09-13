from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import verify_api_key
from services import notes as notes_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


class CreateNoteRequest(BaseModel):
    title: str
    content: str
    category: str = "note"


@router.get("/notes")
async def get_notes(category: Optional[str] = None):
    async with SessionLocal() as db:
        return await notes_service.list_notes(db, category=category)


@router.post("/notes")
async def create_note(request: CreateNoteRequest):
    async with SessionLocal() as db:
        return await notes_service.create_note(db, title=request.title, content=request.content, category=request.category)


@router.get("/notes/search")
async def search_notes(query: str, top_k: int = 5, category: Optional[str] = None):
    async with SessionLocal() as db:
        return await notes_service.search_notes(db, query=query, top_k=top_k, category=category)


@router.delete("/notes/{note_id}")
async def delete_note(note_id: int):
    async with SessionLocal() as db:
        ok = await notes_service.delete_note(db, note_id)
        if not ok:
            raise HTTPException(status_code=404, detail="笔记不存在")
        return {"deleted": True}
