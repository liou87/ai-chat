from fastapi import APIRouter, Depends
from sqlalchemy import select
from database import SessionLocal, ChatSession, Message
from services.auth import verify_api_key

router = APIRouter(dependencies=[Depends(verify_api_key)])

# 获取所有会话列表
@router.get("/sessions")
async def get_sessions():
    async with SessionLocal() as db:
        result = await db.execute(select(ChatSession).order_by(ChatSession.created_at.desc()))
        sessions = result.scalars().all()
        return [{"id": s.id, "title": s.title, "created_at": str(s.created_at)} for s in sessions]

# 获取某个会话的所有消息
@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: int):
    async with SessionLocal() as db:
        result = await db.execute(
            select(Message).where(Message.session_id == session_id).order_by(Message.created_at)
        )
        messages = result.scalars().all()
        return [{"role": m.role, "content": m.content} for m in messages]
