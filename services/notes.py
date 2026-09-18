from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Note
from services.embeddings import embed_text


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


async def create_note(db: AsyncSession, title: str, content: str, category: str = "note",
                       created_at: Optional[datetime] = None) -> dict:
    embedding = await embed_text(f"{title}\n{content}")
    note = Note(title=title, content=content, category=category, embedding=embedding)
    if created_at:
        note.created_at = created_at
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return _serialize(note)


async def create_journal_entry(db: AsyncSession, content: str, entry_date: Optional[datetime] = None) -> dict:
    entry_date = entry_date or datetime.now()
    title = f"日记 {entry_date.strftime('%Y-%m-%d')}"
    return await create_note(db, title=title, content=content, category="journal", created_at=entry_date)


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
    语义检索交给 Postgres + pgvector 做：算出 query 的向量后，
    用余弦距离直接在数据库端排序取 top_k，不用再把全表拉回内存自己算。
    """
    query_embedding = await embed_text(query)
    distance = Note.embedding.cosine_distance(query_embedding).label("distance")
    stmt = select(Note, distance).where(Note.embedding.is_not(None))
    if category:
        stmt = stmt.where(Note.category == category)
    stmt = stmt.order_by(distance).limit(top_k)

    result = await db.execute(stmt)
    return [_serialize(note, with_score=1 - dist) for note, dist in result.all()]
