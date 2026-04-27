from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from services.llm import ask_deepseek
from database import SessionLocal, ChatSession, Message
from typing import List, Optional
import logging
from fastapi.responses import StreamingResponse
from services.llm import ask_deepseek, ask_deepseek_stream

logger = logging.getLogger(__name__)
router = APIRouter()

class MessageSchema(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    session_id: Optional[int] = None   # 可选，没有就新建会话
    messages: List[MessageSchema]


@router.post("/chat")
async def chat(request: ChatRequest):
    db = SessionLocal()
    logger.info(f"收到对话请求,session_id: {request.session_id}")
    try:
        # 没有 session_id 就新建一个会话
        if request.session_id is None:
            session = ChatSession(title=request.messages[0].content[:20])
            db.add(session)
            db.commit()
            db.refresh(session)
            session_id = session.id
        else:
            session_id = request.session_id

        # 把用户最新一条消息存库（最后一条 role=user 的消息）
        last_user_msg = request.messages[-1]
        db.add(Message(
            session_id=session_id,
            role=last_user_msg.role,
            content=last_user_msg.content
        ))
        db.commit()

        # 调用 AI
        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        reply = await ask_deepseek(messages)

        # 把 AI 回复存库
        db.add(Message(
            session_id=session_id,
            role="assistant",
            content=reply
        ))
        db.commit()
        logger.info(f"AI 回复完成,session_id: {session_id}")
        return {"session_id": session_id, "reply": reply}

    finally:
        db.close()  # 无论成功失败都关闭数据库连接
        
##################
@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    # 存用户消息到数据库（和普通接口一样）
    db = SessionLocal()
    try:
        if request.session_id is None:
            session = ChatSession(title=request.messages[0].content[:20])
            db.add(session)
            db.commit()
            db.refresh(session)
            session_id = session.id
        else:
            session_id = request.session_id

        last_user_msg = request.messages[-1]
        db.add(Message(
            session_id=session_id,
            role=last_user_msg.role,
            content=last_user_msg.content
        ))
        db.commit()
    finally:
        db.close()

    # 返回流式响应
    async def generate():
        full_reply = ""
        async for chunk in ask_deepseek_stream(
            [{"role": m.role, "content": m.content} for m in request.messages]
        ):
            full_reply += chunk
            yield chunk

        # 流结束后把完整回复存库
        db2 = SessionLocal()
        try:
            db2.add(Message(
                session_id=session_id,
                role="assistant",
                content=full_reply
            ))
            db2.commit()
        finally:
            db2.close()

    return StreamingResponse(generate(), media_type="text/plain")