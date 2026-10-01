"""
核心记忆（借鉴 Letta 的 core memory）：关于用户的一条条事实，按类别分组，全部常驻在系统提示里，
知行每次开口前就知道"你是谁、在忙什么、喜欢怎样的回答"，不用先去检索。

跟对话记忆（memory.py）的区别：对话记忆是"以前聊过什么"，要检索才用得上，量会越来越大；
核心记忆是"关于你的稳定事实"，量小（有上限）、每轮都带上。
"""
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import ProfileFact
from services import clock

CATEGORIES = {"identity": "身份", "goal": "目标", "preference": "偏好", "status": "近况"}
MAX_FACTS = 40        # 全部要塞进系统提示，条数有上限
MAX_CHARS = 300


class ProfileError(Exception):
    """参数不对、超出上限等，消息直接给用户/模型看。"""


def _serialize(f: ProfileFact) -> dict:
    return {
        "id": f.id,
        "category": f.category,
        "category_label": CATEGORIES.get(f.category, f.category),
        "content": f.content,
        "source": f.source,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


def _clean(category: str, content: str) -> tuple[str, str]:
    if category not in CATEGORIES:
        raise ProfileError(f"类别必须是 {', '.join(CATEGORIES)} 之一")
    content = (content or "").strip()
    if not content:
        raise ProfileError("内容不能为空")
    return category, content[:MAX_CHARS]


async def list_facts(db: AsyncSession) -> list[dict]:
    order = {k: i for i, k in enumerate(CATEGORIES)}
    rows = (await db.execute(select(ProfileFact).order_by(ProfileFact.created_at))).scalars().all()
    return [_serialize(f) for f in sorted(rows, key=lambda f: order.get(f.category, 99))]


async def add_fact(db: AsyncSession, category: str, content: str, source: str = "agent") -> dict:
    category, content = _clean(category, content)
    count = len((await db.execute(select(ProfileFact.id))).all())
    if count >= MAX_FACTS:
        raise ProfileError(f"核心记忆已经有 {MAX_FACTS} 条了，先合并或删掉一些旧的")
    fact = ProfileFact(category=category, content=content, source=source)
    db.add(fact)
    await db.commit()
    await db.refresh(fact)
    return _serialize(fact)


async def update_fact(db: AsyncSession, fact_id: int, content: Optional[str] = None,
                      category: Optional[str] = None) -> Optional[dict]:
    fact = await db.get(ProfileFact, fact_id)
    if fact is None:
        return None
    new_category, new_content = _clean(category or fact.category, content if content is not None else fact.content)
    previous = fact.content
    fact.category, fact.content = new_category, new_content
    fact.updated_at = clock.now()
    await db.commit()
    await db.refresh(fact)
    return {**_serialize(fact), "previous": previous}


async def delete_fact(db: AsyncSession, fact_id: int) -> bool:
    fact = await db.get(ProfileFact, fact_id)
    if fact is None:
        return False
    await db.delete(fact)
    await db.commit()
    return True


async def render_for_prompt(db: AsyncSession) -> str:
    """拼进系统提示的那一段：按类别分组，每条带 id（知行改/删时要用）。没有记忆时返回空串。"""
    facts = await list_facts(db)
    if not facts:
        return ""
    lines = []
    for key, label in CATEGORIES.items():
        group = [f for f in facts if f["category"] == key]
        if group:
            lines.append(f"{label}：" + "；".join(f"[{f['id']}] {f['content']}" for f in group))
    return "\n".join(lines)
