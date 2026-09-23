# 笔记 / RAG 这一摊都在这个包里：notes.py 是核心 CRUD 和检索，chunking.py 是分块纯函数，
# embeddings.py 是向量模型封装，notion.py 是 Notion 只读同步（不属于 notes.py 的公开接口，按需单独导入）。
#
# 这里重新导出 notes.py 的公开接口，外部代码继续用 from services import notes as notes_service
# 这种写法调用 notes_service.search_notes(...)，不用因为这次拆包改调用点。
from .notes import (
    NoteReadOnlyError,
    create_note,
    create_journal_entry,
    list_notes,
    get_note_by_external_id,
    upsert_note_from_external,
    delete_missing_external,
    delete_note,
    search_notes,
)

__all__ = [
    "NoteReadOnlyError",
    "create_note",
    "create_journal_entry",
    "list_notes",
    "get_note_by_external_id",
    "upsert_note_from_external",
    "delete_missing_external",
    "delete_note",
    "search_notes",
]
