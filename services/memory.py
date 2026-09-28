"""
对话记忆：每轮对话结束后把"用户问的 + 知行答的"存一条、算一个向量；
知行需要回忆以前聊过什么时（"上次说的那个""我们之前讨论过"），用 search_memory 工具检索。

只存一问一答的文字，不存工具调用过程；太长的截断，一条记忆对应一轮。
"""
import logging
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from database import MemoryChunk, ChatSession
from services.notes.embeddings import embed_text, embed_texts

logger = logging.getLogger(__name__)

MAX_CHARS = 1500      # 一条记忆最多这么多字（问题和回答各占一部分）
MIN_REPLY_CHARS = 10  # 回答太短（比如出错兜底）就不记


def _compose(user_text: str, reply: str) -> str:
    user_part = (user_text or "").strip()[:500]
    reply_part = (reply or "").strip()[:MAX_CHARS - len(user_part)]
    return f"用户：{user_part}\n知行：{reply_part}"


async def remember_turn(db: AsyncSession, session_id: int, user_text: str, reply: str) -> None:
    """记一轮对话。失败只记日志，不影响聊天本身。"""
    if len((reply or "").strip()) < MIN_REPLY_CHARS:
        return
    try:
        content = _compose(user_text, reply)
        [embedding] = await embed_texts([content])
        db.add(MemoryChunk(session_id=session_id, content=content, embedding=embedding))
        await db.commit()
    except Exception:
        logger.warning(f"记录对话记忆失败，session_id={session_id}", exc_info=True)
        await db.rollback()


async def search_memory(db: AsyncSession, query: str, top_k: int = 5, exclude_session: int | None = None) -> list[dict]:
    """按语义检索以前的对话，默认排除当前会话（当前会话的内容本来就在上下文里）。"""
    query_embedding = await embed_text(query)
    distance = MemoryChunk.embedding.cosine_distance(query_embedding).label("distance")
    stmt = (select(MemoryChunk, ChatSession.title, distance)
            .join(ChatSession, ChatSession.id == MemoryChunk.session_id, isouter=True))
    if exclude_session is not None:
        stmt = stmt.where(MemoryChunk.session_id != exclude_session)
    rows = (await db.execute(stmt.order_by(distance).limit(top_k))).all()
    return [{
        "session_id": m.session_id,
        "session_title": title or "（已删除的会话）",
        "date": m.created_at.strftime("%Y-%m-%d") if m.created_at else None,
        "content": m.content,
        "score": round(1 - dist, 4),
    } for m, title, dist in rows]


async def delete_session_memory(db: AsyncSession, session_id: int) -> None:
    await db.execute(delete(MemoryChunk).where(MemoryChunk.session_id == session_id))
