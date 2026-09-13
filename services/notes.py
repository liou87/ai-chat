import json
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Note
from services.embeddings import embed_text, cosine_similarity


def _serialize(note: Note, with_score: Optional[float] = None) -> dict:
    data = {
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "category": note.category,
        "created_at": note.created_at.isoformat() if note.created_at else None,
    }
    if with_score is not None:
        data["score"] = round(with_score, 4)
    return data


async def create_note(db: AsyncSession, title: str, content: str, category: str = "note") -> dict:
    embedding = await embed_text(f"{title}\n{content}")
    note = Note(title=title, content=content, category=category, embedding=json.dumps(embedding))
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return _serialize(note)


async def list_notes(db: AsyncSession, category: Optional[str] = None) -> list[dict]:
    query = select(Note)
    if category:
        query = query.where(Note.category == category)
    query = query.order_by(Note.created_at.desc())
    result = await db.execute(query)
    return [_serialize(n) for n in result.scalars().all()]


async def delete_note(db: AsyncSession, note_id: int) -> bool:
    note = await db.get(Note, note_id)
    if note is None:
        return False
    await db.delete(note)
    await db.commit()
    return True


async def search_notes(db: AsyncSession, query: str, top_k: int = 5, category: Optional[str] = None) -> list[dict]:
    """
    个人笔记规模（几百条以内）没必要上专门的向量库，
    直接把这个分类下的笔记都取出来，在内存里算余弦相似度排序即可。
    """
    q = select(Note)
    if category:
        q = q.where(Note.category == category)
    result = await db.execute(q)
    notes = [n for n in result.scalars().all() if n.embedding]
    if not notes:
        return []

    query_embedding = await embed_text(query)
    scored = [(cosine_similarity(query_embedding, json.loads(n.embedding)), n) for n in notes]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [_serialize(n, with_score=score) for score, n in scored[:top_k]]
