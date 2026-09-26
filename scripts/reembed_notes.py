"""
把所有笔记的向量用当前的 embedding 模型重算一遍。

换 embedding 模型之后（比如从本地 bge-small-zh 换成 Voyage），旧向量和新向量不在同一个空间，
不重算的话语义搜索结果是乱的。分块本身不变，只是重新切块、重新算向量、替换 note_chunks 里的记录。

用法（在项目根目录，.env 里要有 DATABASE_URL 和 VOYAGE_API_KEY）：
    python scripts/reembed_notes.py            # 全部重算
    python scripts/reembed_notes.py --dry-run  # 只列出会处理哪些笔记，不调接口、不写库
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from sqlalchemy import select, delete  # noqa: E402
from database import SessionLocal, Note, NoteChunk  # noqa: E402
from services.notes.notes import _build_chunks  # noqa: E402

# 每条笔记之间停一下，免费额度的限流比较紧；撞到 429 时 embeddings.py 里还有退避重试
PAUSE_SECONDS = 1.0


async def main(dry_run: bool):
    async with SessionLocal() as db:
        notes = (await db.execute(select(Note).order_by(Note.id))).scalars().all()
    print(f"共 {len(notes)} 条笔记")

    failed = []
    for i, note in enumerate(notes, 1):
        label = f"[{i}/{len(notes)}] #{note.id} {note.title}"
        if dry_run:
            print(label)
            continue
        try:
            chunks = await _build_chunks(note.title or "", note.content or "")
            async with SessionLocal() as db:
                await db.execute(delete(NoteChunk).where(NoteChunk.note_id == note.id))
                db.add_all([
                    NoteChunk(note_id=note.id, chunk_index=j, content=text, embedding=embedding)
                    for j, (text, embedding) in enumerate(chunks)
                ])
                await db.commit()
            print(f"{label}：{len(chunks)} 个分块")
        except Exception as e:  # 单条失败不影响其它，最后汇总
            failed.append(note.id)
            print(f"{label}：失败 {e}")
        await asyncio.sleep(PAUSE_SECONDS)

    if failed:
        print(f"\n{len(failed)} 条失败：{failed}，可以再跑一遍（已成功的重算一次也没关系）")
    elif not dry_run:
        print("\n全部完成")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if sys.platform == "win32":
        # Windows 默认的 Proactor 事件循环跟 asyncpg 的 SSL 连接偶尔不对付，换成 Selector
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main(args.dry_run))
