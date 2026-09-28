import asyncio
import json
import uuid
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import logging
from sqlalchemy import select, func
from fastapi.responses import StreamingResponse
from services.auth import verify_api_key
from services.agent import run_agent, run_agent_stream
from services import persona, clock
from services.session_title import generate_title
from services import memory as memory_service
from database import SessionLocal, ChatSession, Message

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(verify_api_key)])


def _build_system_prompt() -> str:
    now = clock.now()
    return (
        f"{persona.IDENTITY}"
        f"当前时间是 {now.strftime('%Y-%m-%d %H:%M:%S')}（{'周' + '一二三四五六日'[now.weekday()]}）。"
        "可以帮忙管理任务清单，记笔记、检索笔记，记日记/复盘，设置日程提醒，以及联网搜索。"
        "涉及新建、查询、完成、删除任务时，必须调用对应的工具来操作，不要凭空编造任务数据或直接臆测结果。"
        "用户让你记点什么、记录下来时，调用 save_note；用户问的问题可能之前记过笔记或收藏过相关资料，"
        "先调用 search_notes 检索知识库（包括笔记、日记和资料库），再结合检索结果回答，不要凭记忆瞎编；"
        "用了检索结果就在回答里说明出处，出处只写资料标题，不要写 id 之类的内部编号。用户提到以前聊过的事时，调用 search_memory 回忆以前的对话。"
        "用户给了一个链接想存下来时，调用 save_link 收藏进资料库。"
        "用户想记日记/复盘/反思时，调用 add_journal_entry；用户想要周复盘、总结这周做了什么时，"
        "先调用 get_weekly_review 拿到这周的任务/日记/笔记原始数据，再自己组织语言生成总结，"
        "不要在工具返回的数据之外编造具体的事项。"
        "用户想要提醒/闹钟时，调用 set_reminder，注意把「明天」「下周三」这类相对时间，"
        "基于上面给出的当前时间换算成具体的 ISO 8601 时间。"
        "如果问题涉及实时信息（新闻、最新版本、价格等）且笔记里查不到，调用 web_search，"
        "并在回答里说明信息来自网络搜索。"
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
    return [{"role": "system", "content": _build_system_prompt()}] + \
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


def _sse(payload: dict) -> str:
    """AI SDK UI Message Stream 协议的一行：data: 加 JSON，空行结尾。"""
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


##################
@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    if not request.messages:
        raise HTTPException(status_code=400, detail="messages 不能为空")

    async def generate():
        # message_id 贯穿这条 assistant 消息的 text-start/delta/end 三个事件，AI SDK 靠它们对应到同一段文字
        message_id = f"msg_{uuid.uuid4().hex}"
        text_started = False
        tool_used = False
        reply = ""
        # 新会话：用第一句话并行生成一个标题，回复结束时再取结果，不额外拖慢回复
        is_new_session = request.session_id is None
        title_task = asyncio.create_task(generate_title(request.messages[0].content)) if is_new_session else None

        async with SessionLocal() as db:
            try:
                session_id = await _get_or_create_session(db, request)
                turn_index = await _get_turn_index(db, session_id)

                last_user_msg = request.messages[-1]
                db.add(Message(session_id=session_id, role=last_user_msg.role, content=last_user_msg.content))
                await db.commit()

                yield _sse({"type": "start", "messageId": message_id})
                # session id 尽早发出去，前端不用等这一整轮结束就能拿到（新会话场景要靠它去刷新会话列表）
                yield _sse({"type": "data-session", "data": {"sessionId": session_id}})

                async for event in run_agent_stream(db, session_id, turn_index, _build_messages(request)):
                    if event["type"] == "text_delta":
                        if not text_started:
                            yield _sse({"type": "text-start", "id": message_id})
                            text_started = True
                        yield _sse({"type": "text-delta", "id": message_id, "delta": event["content"]})
                    elif event["type"] == "tool_call":
                        tool_used = True
                        yield _sse({"type": "tool-input-available", "toolCallId": event["id"],
                                    "toolName": event["name"], "input": event["args"]})
                    elif event["type"] == "tool_result":
                        yield _sse({"type": "tool-output-available", "toolCallId": event["id"],
                                    "output": event["result"]})
                    elif event["type"] == "final":
                        reply = event["content"]
                        # 超过最大步数的兜底文案没有经过 text_delta，这里补发一次，否则前端什么都收不到
                        if not text_started:
                            yield _sse({"type": "text-start", "id": message_id})
                            yield _sse({"type": "text-delta", "id": message_id, "delta": reply})
                        yield _sse({"type": "text-end", "id": message_id})

                db.add(Message(session_id=session_id, role="assistant", content=reply))
                await db.commit()
                logger.info(f"流式回复完成，session_id: {session_id}")

                # 这一问一答记进对话记忆（失败只记日志）；正文已经全部推给前端了，这一步只是晚一点点收尾
                await memory_service.remember_turn(db, session_id, last_user_msg.content, reply)

                if title_task is not None:
                    title = await title_task
                    title_task = None
                    if title:
                        session = await db.get(ChatSession, session_id)
                        session.title = title
                        await db.commit()
                        yield _sse({"type": "data-title", "data": {"sessionId": session_id, "title": title}})
            except Exception:
                logger.error("流式请求失败", exc_info=True)
                if not text_started:
                    yield _sse({"type": "text-start", "id": message_id})
                yield _sse({"type": "text-delta", "id": message_id,
                            "delta": "\n[出错了，AI 服务暂时不可用，请稍后再试]"})
                yield _sse({"type": "text-end", "id": message_id})

            if title_task is not None:
                title_task.cancel()  # 出错提前结束的话，标题任务就不要了
            yield _sse({"type": "data-meta", "data": {"toolUsed": tool_used}})
            yield _sse({"type": "finish"})
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1"},
    )
