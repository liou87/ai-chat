import asyncio
import json
import uuid
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import logging
from sqlalchemy import select, func
from fastapi.responses import StreamingResponse
from services.auth import require_auth
from services.agent import run_agent, run_agent_stream
from services import persona, clock
from services.session_title import generate_title
from services import memory as memory_service
from services import profile as profile_service
from database import SessionLocal, ChatSession, Message

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_auth)])


def _build_system_prompt(profile_text: str = "") -> str:
    now = clock.now()
    # 核心记忆：关于用户的稳定事实，每轮都带上（方括号里是 id，改/删时用）
    profile_part = (
        f"以下是你记住的关于用户的信息（核心记忆）：\n{profile_text}\n"
        if profile_text else "你还没有记住关于用户的任何信息。"
    )
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
        "基于上面给出的当前时间换算成具体的 ISO 8601 时间；用户只说了日期、没说几点时，先问几点，不要自己默认一个时间；"
        "说的时间今天已经过了，先跟用户确认，不要设一个过去的提醒。"
        "完成、删除任务或取消提醒时，如果有不止一条能对上用户说的（比如两个任务都带「简历」），"
        "先把这几条列出来问用户指哪一条，不要自己挑一个。"
        "如果问题涉及实时信息（新闻、最新版本、价格等）且笔记里查不到，调用 web_search，"
        "并在回答里说明信息来自网络搜索；web_search 返回错误时最多换个关键词再试一次，还失败就直接告诉用户搜索暂时不可用，"
        "不要改用热点、笔记等其它工具拼凑答案。"
        "完成任务、改记忆、设提醒这类操作，工具执行成功后直接简短告诉用户结果，"
        "不要为了顺带给建议再去查目标、任务等其它数据，用户问了再查。"
        "用户问 AI 热点时调用 get_hot_topics；分析某条热点或某个链接时，摘要不够就先用 read_url 读原文，"
        "讲清楚它是什么、为什么重要，再对照核心记忆和用户的目标（需要时 list_goals）说说跟用户有没有关系、值不值得花时间试，"
        "最后可以提议收藏（save_link）或建个任务，但不要没问就直接做。"
        "删除任务、取消提醒、删除记忆这几个工具不会直接执行，会在聊天里弹出确认卡片，用户点确认才生效，"
        "所以调用后要请用户确认，不要说已经删掉了。\n"
        f"{profile_part}"
        "对话中用户透露了关于自己的稳定信息（身份、目标、偏好、近期在忙的事），而上面还没有时，调用 remember_fact 记下来；"
        "已有的信息变了就用 update_fact 改那一条，不要重复记；信息明显不对了用 forget_fact。"
        "记忆是为了更懂用户，回答时自然地用上，不要每次都复述你记得什么。"
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


async def _build_messages(db, request: ChatRequest) -> list:
    profile_text = await profile_service.render_for_prompt(db)
    return [{"role": "system", "content": _build_system_prompt(profile_text)}] + \
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
            reply, trace = await run_agent(db, session_id, turn_index, await _build_messages(db, request))
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
        session_id = turn_index = None   # 建会话之前就出错时，末尾的 data-trace 据此跳过
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

                async for event in run_agent_stream(db, session_id, turn_index, await _build_messages(db, request)):
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
            # 告诉前端这条回复对应哪个会话的第几轮，聊天里的"查看轨迹"按它跳到执行轨迹页
            if session_id is not None:
                yield _sse({"type": "data-trace", "data": {"messageId": message_id, "sessionId": session_id, "turnIndex": turn_index}})
            yield _sse({"type": "data-meta", "data": {"toolUsed": tool_used}})
            yield _sse({"type": "finish"})
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1"},
    )
