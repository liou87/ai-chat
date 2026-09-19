from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Note, NoteChunk
from services.chunking import chunk_text
from services.embeddings import embed_text, embed_texts

# 检索时先多取几倍的分块再按笔记去重：一条长笔记可能有好几个分块都排在前面，
# 直接取 top_k 个分块的话，结果会被同一条笔记占满
OVERSAMPLE = 4


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


async def _build_chunks(title: str, content: str) -> list:
    """
    把笔记切成分块并批量算向量，返回 (分块文本, 向量) 列表。
    每个分块的向量输入是"标题+换行+分块文本"，这样长笔记后半段的分块也能和主题保持关联。
    正文为空时用标题当唯一的分块。
    """
    texts = chunk_text(content) or [""]
    embeddings = await embed_texts([f"{title}\n{t}" for t in texts])
    return list(zip(texts, embeddings))


async def create_note(db: AsyncSession, title: str, content: str, category: str = "note",
                       created_at: Optional[datetime] = None) -> dict:
    # 先算向量再开始写库，避免慢的推理过程占着事务
    chunks = await _build_chunks(title, content)

    note = Note(title=title, content=content, category=category)
    if created_at:
        note.created_at = created_at
    db.add(note)
    await db.flush()  # 拿到 note.id，分块要用
    db.add_all([
        NoteChunk(note_id=note.id, chunk_index=i, content=text, embedding=embedding)
        for i, (text, embedding) in enumerate(chunks)
    ])
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
    # 分块靠 note_chunks.note_id 的外键级联删除，这里不用管
    note = await db.get(Note, note_id)
    if note is None:
        return False
    await db.delete(note)
    await db.commit()
    return True


async def search_notes(db: AsyncSession, query: str, top_k: int = 5, category: Optional[str] = None) -> list[dict]:
    """
    语义检索在分块上做：用 HNSW 索引按余弦距离取最近的 top_k * OVERSAMPLE 个分块，
    再按笔记去重，每条笔记只保留得分最高的那个分块，最后取前 top_k 条笔记。
    按分类过滤发生在近似最近邻查找之后，所以过滤后结果可能少于 top_k，多取几倍分块能缓解。
    """
    query_embedding = await embed_text(query)
    distance = NoteChunk.embedding.cosine_distance(query_embedding).label("distance")
    stmt = select(NoteChunk.note_id, distance).join(Note, Note.id == NoteChunk.note_id)
    if category:
        stmt = stmt.where(Note.category == category)
    stmt = stmt.order_by(distance).limit(top_k * OVERSAMPLE)

    rows = (await db.execute(stmt)).all()

    # rows 已经按距离从近到远排好，每条笔记第一次出现的就是它得分最高的分块
    best = {}
    for note_id, dist in rows:
        if note_id not in best:
            best[note_id] = dist
    note_ids = list(best)[:top_k]
    if not note_ids:
        return []

    notes = {n.id: n for n in (await db.execute(select(Note).where(Note.id.in_(note_ids)))).scalars().all()}
    return [_serialize(notes[i], with_score=1 - best[i]) for i in note_ids if i in notes]
