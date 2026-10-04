from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from database import EvalCandidate, MessageFeedback, SessionLocal
from services import clock
from services.auth import require_auth

# 第四层评测：线上反馈回流。聊天里每条回复可以点赞/点踩（点踩选原因），执行轨迹页可以把某一轮标成"用例候选"，
# 本地跑 evals/pull_candidates.py 把候选导出成 YAML 草稿，补上期望就能并进评测用例集
router = APIRouter(dependencies=[Depends(require_auth)])

REASONS = {"wrong": "答错了", "fabricated": "编造了内容", "missed_tool": "该用工具没用", "verbose": "啰嗦", "other": "其它"}


class FeedbackRequest(BaseModel):
    rating: str                      # up / down
    reason: Optional[str] = None
    comment: Optional[str] = None


class CandidateRequest(BaseModel):
    session_id: int
    turn_index: int
    note: Optional[str] = None


def _feedback(f: MessageFeedback) -> dict:
    return {"session_id": f.session_id, "turn_index": f.turn_index, "rating": f.rating,
            "reason": f.reason, "reason_label": REASONS.get(f.reason), "comment": f.comment,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None}


@router.get("/feedback")
async def list_feedback(session_id: int):
    async with SessionLocal() as db:
        rows = (await db.execute(select(MessageFeedback).where(MessageFeedback.session_id == session_id))).scalars().all()
        return [_feedback(f) for f in rows]


@router.put("/feedback/{session_id}/{turn_index}")
async def set_feedback(session_id: int, turn_index: int, body: FeedbackRequest):
    if body.rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating 只能是 up 或 down")
    if body.reason and body.reason not in REASONS:
        raise HTTPException(status_code=400, detail=f"reason 只能是 {list(REASONS)} 之一")
    async with SessionLocal() as db:
        row = (await db.execute(select(MessageFeedback).where(
            MessageFeedback.session_id == session_id, MessageFeedback.turn_index == turn_index))).scalars().first()
        if row is None:
            row = MessageFeedback(session_id=session_id, turn_index=turn_index)
            db.add(row)
        row.rating = body.rating
        # 点赞时清掉之前点踩留下的原因
        row.reason = body.reason if body.rating == "down" else None
        row.comment = ((body.comment or "").strip()[:500] or None) if body.rating == "down" else None
        row.updated_at = clock.now()
        await db.commit()
        await db.refresh(row)
        return _feedback(row)


@router.delete("/feedback/{session_id}/{turn_index}")
async def clear_feedback(session_id: int, turn_index: int):
    async with SessionLocal() as db:
        await db.execute(delete(MessageFeedback).where(
            MessageFeedback.session_id == session_id, MessageFeedback.turn_index == turn_index))
        await db.commit()
    return {"ok": True}


@router.get("/eval-candidates")
async def list_candidates():
    async with SessionLocal() as db:
        rows = (await db.execute(select(EvalCandidate).order_by(EvalCandidate.created_at.desc()))).scalars().all()
        return [{"id": c.id, "session_id": c.session_id, "turn_index": c.turn_index, "note": c.note,
                 "exported": c.exported, "created_at": c.created_at.isoformat() if c.created_at else None} for c in rows]


@router.post("/eval-candidates")
async def add_candidate(body: CandidateRequest):
    async with SessionLocal() as db:
        row = (await db.execute(select(EvalCandidate).where(
            EvalCandidate.session_id == body.session_id, EvalCandidate.turn_index == body.turn_index))).scalars().first()
        if row is None:
            row = EvalCandidate(session_id=body.session_id, turn_index=body.turn_index)
            db.add(row)
        row.note = (body.note or "").strip()[:500] or None
        row.exported = False
        await db.commit()
        return {"id": row.id, "session_id": row.session_id, "turn_index": row.turn_index, "note": row.note}


@router.delete("/eval-candidates/{session_id}/{turn_index}")
async def remove_candidate(session_id: int, turn_index: int):
    async with SessionLocal() as db:
        await db.execute(delete(EvalCandidate).where(
            EvalCandidate.session_id == session_id, EvalCandidate.turn_index == turn_index))
        await db.commit()
    return {"ok": True}
