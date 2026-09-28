"""
把已有的历史对话补进对话记忆（memory_chunks）。对话记忆功能上线前的会话没有记忆，跑一次这个脚本补上。
按会话把消息两两配成"用户问 + 知行答"，已经有记忆的会话跳过，可以重复跑。

用法（项目根目录，.env 里要有 DATABASE_URL 和 VOYAGE_API_KEY）：
    python scripts/backfill_memory.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from sqlalchemy import select, func  # noqa: E402
from database import SessionLocal, ChatSession, Message, MemoryChunk  # noqa: E402
from services import memory as memory_service  # noqa: E402


async def main():
    async with SessionLocal() as db:
        sessions = (await db.execute(select(ChatSession).order_by(ChatSession.id))).scalars().all()
    total = 0
    for s in sessions:
        async with SessionLocal() as db:
            has = (await db.execute(select(func.count()).select_from(MemoryChunk).where(MemoryChunk.session_id == s.id))).scalar_one()
            if has:
                print(f"#{s.id} {s.title}：已有记忆，跳过")
                continue
            msgs = (await db.execute(select(Message).where(Message.session_id == s.id).order_by(Message.created_at))).scalars().all()
            pending_user = None
            count = 0
            for m in msgs:
                if m.role == "user":
                    pending_user = m.content
                elif m.role == "assistant" and pending_user is not None:
                    await memory_service.remember_turn(db, s.id, pending_user, m.content)
                    pending_user = None
                    count += 1
            total += count
            print(f"#{s.id} {s.title}：补了 {count} 轮")
    print(f"完成，共 {total} 轮")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
