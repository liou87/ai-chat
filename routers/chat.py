import asyncio
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import logging
from sqlalchemy import select, func
from fastapi.responses import StreamingResponse
from services.auth import verify_api_key
from services.agent import run_agent
from database import SessionLocal, ChatSession, Message

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(verify_api_key)])

SYSTEM_PROMPT = (
    "你是用户的个人工作台助手，可以帮忙管理任务清单，也能帮用户记笔记、检索笔记。"
    "涉及新建、查询、完成、删除任务时，必须调用对应的工具来操作，不要凭空编造任务数据或直接臆测结果。"
    "用户让你记点什么、记录下来时，调用 save_note；用户问的问题可能之前记过笔记，"
    "先调用 search_notes 检索一下，再结合检索结果回答，不要凭记忆瞎编。"
)

class MessageSchema(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    session_id: Optional[int] = None   # 可选，没有就新建会话
    messages: List[MessageSchema]


async def _get_or_create_session(db, request: ChatRequest) -> int:
    if request.session_id is None:
        session = ChatSession(title=request.messages[0].content[:20])
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session.id
    return request.session_id


async def _get_turn_index(db, session_id: int) -> int:
    result = await db.execute(select(func.count()).select_from(Message).where(Message.session_id == session_id))
    return result.scalar_one()


def _build_messages(request: ChatRequest) -> list:
    return [{"role": "system", "content": SYSTEM_PROMPT}] + \
           [{"role": m.role, "content": m.content} for m in request.messages]


@router.post("/chat")
async def chat(request: ChatRequest):
    if not request.messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")

    logger.info(f"收到对话请求,session_id: {request.session_id}")
    async with SessionLocal() as db:
        session_id = await _get_or_create_session(db, request)
        turn_index = await _get_turn_index(db, session_id)

        # 把用户最新一条消息存库（最后一条 role=user 的消息）
        last_user_msg = request.messages[-1]
        db.add(Message(
            session_id=session_id,
            role=last_user_msg.role,
            content=last_user_msg.content
        ))
        await db.commit()

        try:
            reply, trace = await run_agent(db, session_id, turn_index, _build_messages(request))
        except Exception:
            logger.error(f"AI 调用失败，session_id: {session_id}", exc_info=True)
            raise HTTPException(status_code=502, detail="AI 服务暂时不可用，请稍后再试")

        # 把 AI 回复存库
        db.add(Message(
            session_id=session_id,
            role="assistant",
            content=reply
        ))
        await db.commit()
        logger.info(f"AI 回复完成,session_id: {session_id}")
        return {"session_id": session_id, "reply": reply, "trace": trace}


##################
@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    if not request.messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")

    # 存用户消息到数据库（和普通接口一样）
    async with SessionLocal() as db:
        session_id = await _get_or_create_session(db, request)
        turn_index = await _get_turn_index(db, session_id)

        last_user_msg = request.messages[-1]
        db.add(Message(
            session_id=session_id,
            role=last_user_msg.role,
            content=last_user_msg.content
        ))
        await db.commit()

        # 工具调用循环不适合逐 token 真流式（可能要连续调几次工具），
        # 所以先把完整流程跑完，再把最终文本按小段"回放"给前端，保留打字机效果，
        # 同时避免为了拿流式效果而对模型多发一次请求（省钱、也避免两次结果不一致）。
        try:
            reply, trace = await run_agent(db, session_id, turn_index, _build_messages(request))
        except Exception:
            logger.error(f"流式请求失败，session_id: {session_id}", exc_info=True)

            async def error_stream():
                yield "\n[出错了，AI 服务暂时不可用，请稍后再试]"

            return StreamingResponse(error_stream(), media_type="text/plain",
                                      headers={"X-Session-Id": str(session_id)})

        db.add(Message(session_id=session_id, role="assistant", content=reply))
        await db.commit()

    tool_used = any(t["type"] == "tool_call" for t in trace)

    async def generate():
        chunk_size = 6
        for i in range(0, len(reply), chunk_size):
            yield reply[i:i + chunk_size]
            await asyncio.sleep(0.02)

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={"X-Session-Id": str(session_id), "X-Tool-Used": str(tool_used).lower()},
    )
