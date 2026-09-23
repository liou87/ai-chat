from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import verify_api_key
from services import notes as notes_service
from services.notes import notion as notion_service
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


@router.post("/notes/sync-notion")
async def sync_notion():
    async with SessionLocal() as db:
        result = await notion_service.sync_notion_notes(db)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result


@router.delete("/notes/{note_id}")
async def delete_note(note_id: int):
    async with SessionLocal() as db:
        try:
            ok = await notes_service.delete_note(db, note_id)
        except notes_service.NoteReadOnlyError as e:
            raise HTTPException(status_code=403, detail=str(e))
        if not ok:
            raise HTTPException(status_code=404, detail="笔记不存在")
        return {"deleted": True}
