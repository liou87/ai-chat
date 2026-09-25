from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from services import goals as goals_service


async def _create_goal(db: AsyncSession, args: dict) -> dict:
    target_date = None
    if args.get("target_date"):
        try:
            target_date = datetime.fromisoformat(args["target_date"])
        except ValueError:
            target_date = None
    try:
        return await goals_service.create_goal(
            db, title=args["title"], tier=args["tier"], parent_id=args.get("parent_id"),
            description=args.get("description"), target_date=target_date,
        )
    except goals_service.InvalidGoalHierarchy as e:
        return {"error": str(e)}


async def _list_goals(db: AsyncSession, args: dict) -> dict:
    goals = await goals_service.list_goals(db, tier=args.get("tier"))
    return {"goals": goals}


async def _update_goal_progress(db: AsyncSession, args: dict) -> dict:
    goal = await goals_service.update_goal_progress(
        db, goal_id=int(args["goal_id"]), progress=int(args["progress"]), status=args.get("status")
    )
    if goal is None:
        return {"error": f"未找到 id 为 {args['goal_id']} 的目标"}
    return goal


TOOLS = [
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "create_goal",
                "description": "创建一个目标，分三层：phase（阶段目标）、month（月目标）、week（周目标）。"
                                "month 必须挂在某个 phase 下面，week 必须挂在某个 month 下面，"
                                "如果不知道上级目标的 id，先调用 list_goals 查出来。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "目标标题"},
                        "tier": {"type": "string", "enum": ["phase", "month", "week"], "description": "目标层级"},
                        "parent_id": {"type": "integer", "description": "上级目标 id，phase 不需要，month/week 必填"},
                        "description": {"type": "string", "description": "补充说明，比如下一个里程碑是什么"},
                        "target_date": {
                            "type": "string",
                            "description": "目标日期，ISO 8601 格式，不确定就留空",
                        },
                    },
                    "required": ["title", "tier"],
                },
            },
        },
        "handler": _create_goal,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "list_goals",
                "description": "查询目标列表，可选按层级筛选",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tier": {"type": "string", "enum": ["phase", "month", "week"], "description": "只看某一层，不填就看全部"},
                    },
                },
            },
        },
        "handler": _list_goals,
    },
    {
        "schema": {
            "type": "function",
            "function": {
                "name": "update_goal_progress",
                "description": "更新某个目标的进度百分比（0-100），可以顺带更新一句状态描述。"
                                "如果不知道目标 id，先调用 list_goals 查出来。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "goal_id": {"type": "integer", "description": "目标 id"},
                        "progress": {"type": "integer", "description": "0 到 100 之间的进度百分比"},
                        "status": {"type": "string", "description": "状态描述，比如「正常」「轻度迟缓」「证据不足」，不确定就留空"},
                    },
                    "required": ["goal_id", "progress"],
                },
            },
        },
        "handler": _update_goal_progress,
    },
]
