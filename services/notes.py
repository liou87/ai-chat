from datetime import datetime
from typing import Optional
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from database import Note, NoteChunk
from services.chunking import chunk_text
from services.embeddings import embed_text, embed_texts

# 检索时先多取几倍的分块再按笔记去重：一条长笔记可能有好几个分块都排在前面，
# 直接取 top_k 个分块的话，结果会被同一条笔记占满
OVERSAMPLE = 4


class NoteReadOnlyError(Exception):
    """外部来源（Notion）的笔记在本地是只读的，不允许删除。"""


def _serialize(note: Note, with_score: Optional[float] = None) -> dict:
    data = {
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "category": note.category,
        "source": note.source,
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


async def get_note_by_external_id(db: AsyncSession, external_id: str, source: str = "notion") -> Optional[Note]:
    result = await db.execute(select(Note).where(Note.source == source, Note.external_id == external_id))
    return result.scalars().first()


async def upsert_note_from_external(db: AsyncSession, external_id: str, title: str, content: str,
                                     external_updated_at: datetime, source: str = "notion") -> tuple:
    """
    按 external_id 导入外部笔记：已存在就更新并重建分块，不存在就新建。
    返回 (笔记, 是否新建)。分块向量先算好再写库，替换分块和更新笔记在同一个事务里。
    """
    chunks = await _build_chunks(title, content)

    note = await get_note_by_external_id(db, external_id, source)
    created = note is None
    if created:
        note = Note(source=source, external_id=external_id, category="note")
        db.add(note)
    else:
        await db.execute(delete(NoteChunk).where(NoteChunk.note_id == note.id))
    note.title = title
    note.content = content
    note.external_updated_at = external_updated_at
    await db.flush()
    db.add_all([
        NoteChunk(note_id=note.id, chunk_index=i, content=text, embedding=embedding)
        for i, (text, embedding) in enumerate(chunks)
    ])
    await db.commit()
    await db.refresh(note)
    return _serialize(note), created


async def delete_missing_external(db: AsyncSession, source: str, existing_ids: list) -> int:
    """
    删除某个来源下、但来源系统里已经不存在的笔记（外部来源的笔记本来就是只读副本）。
    existing_ids 是来源系统这次列出的全部 id；分块靠外键级联一起删。返回删除的条数。
    """
    result = await db.execute(
        delete(Note).where(Note.source == source, Note.external_id.not_in(existing_ids))
    )
    await db.commit()
    return result.rowcount


async def delete_note(db: AsyncSession, note_id: int) -> bool:
    # 分块靠 note_chunks.note_id 的外键级联删除，这里不用管
    note = await db.get(Note, note_id)
    if note is None:
        return False
    if note.source == "notion":
        # 只读导入：本地删掉的话，下次同步会因为找不到 external_id 又被导入回来
        raise NoteReadOnlyError("来自 Notion 的笔记请在 Notion 里删除")
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
