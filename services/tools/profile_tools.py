from sqlalchemy.ext.asyncio import AsyncSession
from services import profile as profile_service
from services import confirm
from database import ProfileFact

_CATEGORY_DESC = "identity（身份：学校、专业、工作）、goal（目标：在准备什么、想达成什么）、preference（偏好：喜欢怎样的回答、作息、习惯）、status（近况：这段时间在忙的事，会过时）"


async def _remember_fact(db: AsyncSession, args: dict) -> dict:
    try:
        fact = await profile_service.add_fact(db, args.get("category", ""), args.get("content", ""))
    except profile_service.ProfileError as e:
        return {"error": str(e)}
    return {"remembered": True, **fact}


async def _update_fact(db: AsyncSession, args: dict) -> dict:
    try:
        fact = await profile_service.update_fact(db, int(args["fact_id"]), content=args.get("content"), category=args.get("category"))
    except profile_service.ProfileError as e:
        return {"error": str(e)}
    if fact is None:
        return {"error": f"没有 id 为 {args['fact_id']} 的记忆"}
    return {"updated": True, **fact}


async def _forget_fact(db: AsyncSession, args: dict) -> dict:
    """删除核心记忆需要用户确认，这里只返回待确认结果（见 services/confirm.py）"""
    fact = await db.get(ProfileFact, int(args["fact_id"]))
    if fact is None:
        return {"error": f"没有 id 为 {args['fact_id']} 的记忆"}
    return confirm.pending("forget_fact", fact.id, fact.content)


TOOLS = [
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "remember_fact",
                "description": "把关于用户的一条稳定信息记进核心记忆（每次对话都会带上）。"
                                "用户提到自己的身份、目标、偏好或者近期在忙的事，而核心记忆里还没有时调用；"
                                "已经有相关的一条就用 update_fact 改那条，不要重复记。"
                                "不要记一次性的小事、具体的任务（那是任务）、敏感信息（密码、证件号、健康隐私）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "enum": ["identity", "goal", "preference", "status"], "description": _CATEGORY_DESC},
                        "content": {"type": "string", "description": "一句话，以用户为主语或省略主语，比如「在准备 agent 开发方向的工作」"},
                    },
                    "required": ["category", "content"],
                },
            },
        },
        "handler": _remember_fact,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "update_fact",
                "description": "修改核心记忆里已有的一条（信息变了、需要补充或合并时），fact_id 见系统提示里方括号中的数字",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "fact_id": {"type": "integer"},
                        "content": {"type": "string", "description": "改成的新内容"},
                        "category": {"type": "string", "enum": ["identity", "goal", "preference", "status"]},
                    },
                    "required": ["fact_id", "content"],
                },
            },
        },
        "handler": _update_fact,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "forget_fact",
                "description": "删除核心记忆里的一条（信息已经不对了、用户让你忘掉）。需要用户在聊天里点确认后才会真正删除",
                "parameters": {
                    "type": "object",
                    "properties": {"fact_id": {"type": "integer"}},
                    "required": ["fact_id"],
                },
            },
        },
        "handler": _forget_fact,
    },
]
