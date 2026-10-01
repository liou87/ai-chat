"""
需要用户确认的操作（删任务、取消提醒、删核心记忆）：agent 工具不直接执行，而是返回一个"待确认"结果。
前端看到这种工具结果就在聊天里画一张确认卡片，用户点确认后前端直接调对应的删除接口执行，
不再多走一轮模型。模型从这个结果里知道"已经请用户确认了"，不会误说成"已经删掉了"。
"""

# 前端按 action 决定确认后调哪个接口、卡片上怎么写
ACTIONS = {
    "delete_task": "删除任务",
    "cancel_reminder": "取消提醒",
    "forget_fact": "删除记忆",
}


def pending(action: str, target_id: int, target_title: str) -> dict:
    return {
        "needs_confirmation": True,
        "action": action,
        "action_label": ACTIONS[action],
        "target_id": target_id,
        "target_title": target_title,
        "note": "已经在聊天里弹出确认卡片，用户点确认后才会执行。回复时请用户确认，不要说已经完成了。",
    }
