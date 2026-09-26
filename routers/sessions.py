from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from database import SessionLocal, ChatSession, Message, AgentTrace
from services.auth import verify_api_key

router = APIRouter(dependencies=[Depends(verify_api_key)])

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
        await db.delete(session)
        await db.commit()
        return {"deleted": True}
