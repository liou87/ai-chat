from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.auth import verify_api_key
from services import notes as notes_service
from services.notes import notion as notion_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


class CreateNoteRequest(BaseModel):
    title: str = ""
    content: str = ""
    category: str = "note"
    structured_data: Optional[dict] = None   # 日记复盘的引导问答+评分，只有 category="journal" 会用到


class UpdateNoteRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class WeeklyReviewRequest(BaseModel):
    content: str


@router.get("/notes")
async def get_notes(category: Optional[str] = None):
    async with SessionLocal() as db:
        return await notes_service.list_notes(db, category=category)


@router.post("/notes")
async def create_note(request: CreateNoteRequest):
    async with SessionLocal() as db:
        if request.category == "journal":
            # 日记统一走 create_journal_entry：标题按日期自动生成，结构化复盘也在这里渲染成正文，
            # 跟 agent 工具 add_journal_entry 走的是同一条路径，不会出现两套不一致的行为
            return await notes_service.create_journal_entry(db, content=request.content, structured_data=request.structured_data)
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


@router.post("/notes/weekly-review")
async def save_weekly_review(request: WeeklyReviewRequest):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="复盘内容为空")
    async with SessionLocal() as db:
        return await notes_service.save_weekly_review(db, request.content)


@router.patch("/notes/{note_id}")
async def update_note(note_id: int, request: UpdateNoteRequest):
    async with SessionLocal() as db:
        try:
            note = await notes_service.update_note(db, note_id, title=request.title, content=request.content)
        except notes_service.NoteReadOnlyError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except notes_service.NoteNotEditableError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if note is None:
            raise HTTPException(status_code=404, detail="笔记不存在")
        return note


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
