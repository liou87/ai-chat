import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from services.auth import verify_api_key
from database import SessionLocal, AgentTrace, ChatSession, Message

router = APIRouter(dependencies=[Depends(verify_api_key)])

# 执行轨迹页：agent 每轮对话的每一步（模型调用、工具调用、工具结果、最终回复）都记在 agent_traces 里，
# 这里按"会话 + 轮次"聚合成列表，点开一轮看详细步骤。类似 LangSmith / Langfuse 的单轮 trace 视图。

LIST_LIMIT = 50


def _payload(t: AgentTrace) -> dict:
    try:
        return json.loads(t.payload or "{}")
    except json.JSONDecodeError:
        return {}


def _is_error(t: AgentTrace) -> bool:
    p = _payload(t)
    if t.type == "tool_result":
        result = p.get("result")
        return isinstance(result, dict) and "error" in result
    return t.type == "final" and bool(p.get("truncated"))


def _summarize(rows: list, title: str, question: Optional[str]) -> dict:
    first, last = rows[0], rows[-1]
    final = next((r for r in reversed(rows) if r.type == "final"), None)
    return {
        "session_id": first.session_id,
        "turn_index": first.turn_index,
        "session_title": title,
        "question": (question or "")[:120],
        "started_at": first.created_at.isoformat() if first.created_at else None,
        # 总耗时：模型调用和工具执行加起来（各步之间的落库开销不算）
        "duration_ms": sum(r.duration_ms or 0 for r in rows),
        "prompt_tokens": sum(r.prompt_tokens or 0 for r in rows),
        "completion_tokens": sum(r.completion_tokens or 0 for r in rows),
        "llm_calls": sum(1 for r in rows if r.type == "llm"),
        "tools": sorted({r.name for r in rows if r.type == "tool_call" and r.name}),
        "has_error": any(_is_error(r) for r in rows),
        "answer": (_payload(final).get("content") or "")[:160] if final else "",
        "finished_at": last.created_at.isoformat() if last.created_at else None,
    }


async def _questions(db, keys: set) -> dict:
    """每轮对应的用户问题：turn_index 是这轮开始前会话里已有的消息数，所以第 turn_index 条消息就是这轮的提问。"""
    session_ids = {k[0] for k in keys}
    msgs = (await db.execute(
        select(Message).where(Message.session_id.in_(session_ids)).order_by(Message.session_id, Message.created_at)
    )).scalars().all()
    by_session = {}
    for m in msgs:
        by_session.setdefault(m.session_id, []).append(m)
    out = {}
    for sid, turn in keys:
        lst = by_session.get(sid, [])
        if turn is not None and 0 <= turn < len(lst) and lst[turn].role == "user":
            out[(sid, turn)] = lst[turn].content
    return out


@router.get("/traces")
async def list_traces(errors_only: bool = False, tool: Optional[str] = None, limit: int = LIST_LIMIT):
    async with SessionLocal() as db:
        # 先取最近一批轨迹行，再按 (会话, 轮次) 分组；行数给足余量，保证能凑够 limit 轮
        rows = (await db.execute(
            select(AgentTrace).order_by(AgentTrace.id.desc()).limit(limit * 20)
        )).scalars().all()
        groups = {}
        for r in reversed(rows):
            groups.setdefault((r.session_id, r.turn_index), []).append(r)
        titles = {s.id: s.title for s in (await db.execute(
            select(ChatSession).where(ChatSession.id.in_({k[0] for k in groups}))
        )).scalars().all()}
        questions = await _questions(db, set(groups))

        turns = [_summarize(sorted(g, key=lambda r: r.id), titles.get(k[0], "（已删除的会话）"), questions.get(k))
                 for k, g in groups.items()]
        if errors_only:
            turns = [t for t in turns if t["has_error"]]
        if tool:
            turns = [t for t in turns if tool in t["tools"]]
        turns.sort(key=lambda t: t["started_at"] or "", reverse=True)
        return turns[:limit]


@router.get("/traces/{session_id}/{turn_index}")
async def get_trace(session_id: int, turn_index: int):
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(AgentTrace).where(AgentTrace.session_id == session_id, AgentTrace.turn_index == turn_index)
            .order_by(AgentTrace.id)
        )).scalars().all()
        if not rows:
            raise HTTPException(status_code=404, detail="没有这一轮的轨迹")
        session = await db.get(ChatSession, session_id)
        questions = await _questions(db, {(session_id, turn_index)})
        return {
            **_summarize(rows, session.title if session else "（已删除的会话）", questions.get((session_id, turn_index))),
            "steps": [{
                "step_index": r.step_index,
                "type": r.type,
                "name": r.name,
                "payload": _payload(r),
                "duration_ms": r.duration_ms,
                "prompt_tokens": r.prompt_tokens,
                "completion_tokens": r.completion_tokens,
                "is_error": _is_error(r),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            } for r in rows],
        }
