from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from database import SessionLocal, ChatSession, Message, AgentTrace, MessageFeedback, EvalCandidate
from services import memory as memory_service
from services.auth import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])

# 获取所有会话列表
@router.get("/sessions")
async def get_sessions():
    async with SessionLocal() as db:
        result = await db.execute(select(ChatSession).order_by(ChatSession.created_at.desc()))
        sessions = result.scalars().all()
        return [{"id": s.id, "title": s.title, "created_at": s.created_at.isoformat() if s.created_at else None} for s in sessions]

# 获取某个会话的所有消息
@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: int):
    async with SessionLocal() as db:
        result = await db.execute(
            select(Message).where(Message.session_id == session_id).order_by(Message.created_at)
        )
        messages = result.scalars().all()
        return [{"role": m.role, "content": m.content} for m in messages]


# 删除会话：消息和工具调用轨迹都是按 session_id 关联的（没有外键），一起删掉
@router.delete("/sessions/{session_id}")
async def delete_session(session_id: int):
    async with SessionLocal() as db:
        session = await db.get(ChatSession, session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="会话不存在")
        await db.execute(delete(Message).where(Message.session_id == session_id))
        await db.execute(delete(AgentTrace).where(AgentTrace.session_id == session_id))
        await db.execute(delete(MessageFeedback).where(MessageFeedback.session_id == session_id))
        await db.execute(delete(EvalCandidate).where(EvalCandidate.session_id == session_id))
        await memory_service.delete_session_memory(db, session_id)
        await db.delete(session)
        await db.commit()
        return {"deleted": True}


class AppendNoteRequest(BaseModel):
    text: str


# 用户在聊天里点了确认卡片（比如确认删除某个任务）之后，把结果追加到这个会话最后一条知行回复的末尾，
# 这样重新打开会话、或者下一轮对话时，知行都知道这个操作已经执行了
@router.post("/sessions/{session_id}/append-note")
async def append_note(session_id: int, request: AppendNoteRequest):
    async with SessionLocal() as db:
        last = (await db.execute(
            select(Message).where(Message.session_id == session_id, Message.role == "assistant")
            .order_by(Message.created_at.desc())
        )).scalars().first()
        if last is None:
            raise HTTPException(status_code=404, detail="这个会话还没有回复")
        last.content = f"{last.content}\n\n{request.text.strip()}"
        await db.commit()
        return {"ok": True}
