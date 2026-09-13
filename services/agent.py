import json
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from database import AgentTrace
from services.llm import ask_deepseek_with_tools
from services.tools import TOOL_SCHEMAS, TOOL_HANDLERS

logger = logging.getLogger(__name__)

MAX_STEPS = 5  # 最多允许模型连续调用几轮工具，防止死循环


async def _log_trace(db: AsyncSession, session_id: int, turn_index: int, step_index: int,
                      trace_type: str, name: str, payload: dict):
    db.add(AgentTrace(
        session_id=session_id,
        turn_index=turn_index,
        step_index=step_index,
        type=trace_type,
        name=name,
        payload=json.dumps(payload, ensure_ascii=False, default=str),
    ))
    await db.commit()


async def run_agent(db: AsyncSession, session_id: int, turn_index: int, messages: list) -> tuple[str, list]:
    """
    ReAct 风格的 tool-calling 循环：
    模型可以连续多次决定调用工具，每次工具执行结果都喂回去，直到模型给出最终自然语言回复。
    返回 (最终回复文本, 本轮 trace 列表)。
    """
    conversation = list(messages)  # 不修改调用方传入的原始列表
    trace = []

    for step in range(MAX_STEPS):
        message = await ask_deepseek_with_tools(conversation, TOOL_SCHEMAS)

        if not message.tool_calls:
            final_text = message.content or ""
            await _log_trace(db, session_id, turn_index, step, "final", None, {"content": final_text})
            trace.append({"type": "final", "content": final_text})
            return final_text, trace

        # 模型要求调用一个或多个工具：先把这条 assistant 消息（含 tool_calls）放回对话
        conversation.append({
            "role": "assistant",
            "content": message.content,
            "tool_calls": [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.function.name, "arguments": call.function.arguments},
                }
                for call in message.tool_calls
            ],
        })

        for call in message.tool_calls:
            name = call.function.name
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}

            await _log_trace(db, session_id, turn_index, step, "tool_call", name, {"args": args})
            trace.append({"type": "tool_call", "name": name, "args": args})

            handler = TOOL_HANDLERS.get(name)
            if handler is None:
                result = {"error": f"未知工具：{name}"}
            else:
                try:
                    result = await handler(db, args)
                except Exception:
                    logger.error(f"工具执行失败：{name}", exc_info=True)
                    result = {"error": "工具执行失败"}

            await _log_trace(db, session_id, turn_index, step, "tool_result", name, {"result": result})
            trace.append({"type": "tool_result", "name": name, "result": result})

            conversation.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })

    # 超过最大步数还没结束，兜底返回
    fallback = "处理这个请求需要的步骤太多了，我先停在这里，你可以换个更具体的说法重试。"
    await _log_trace(db, session_id, turn_index, MAX_STEPS, "final", None, {"content": fallback, "truncated": True})
    trace.append({"type": "final", "content": fallback, "truncated": True})
    return fallback, trace
