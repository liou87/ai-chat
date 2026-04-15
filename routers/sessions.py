from fastapi import APIRouter
from database import SessionLocal, ChatSession, Message

router = APIRouter()

# 获取所有会话列表
@router.get("/sessions")
def get_sessions():
    db = SessionLocal()
    try:
        sessions = db.query(ChatSession).order_by(ChatSession.created_at.desc()).all()
        return [{"id": s.id, "title": s.title, "created_at": str(s.created_at)} for s in sessions]
    finally:
        db.close()

# 获取某个会话的所有消息
@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: int):
    db = SessionLocal()
    try:
        messages = db.query(Message).filter(Message.session_id == session_id).order_by(Message.created_at).all()
        return [{"role": m.role, "content": m.content} for m in messages]
    finally:
        db.close()