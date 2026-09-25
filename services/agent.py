import json
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from database import AgentTrace
from services.llm import ask_deepseek_with_tools_stream
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


async def run_agent_stream(db: AsyncSession, session_id: int, turn_index: int, messages: list):
    """
    ReAct 风格的 tool-calling 循环，流式版本：每一步都是真流式请求（见 ask_deepseek_with_tools_stream），
    模型输出文字时逐块 yield 出去，请求调用工具时，工具调用和执行结果各自作为一个事件 yield 出去，
    调用方（REST 层）负责把这些事件转成前端认识的格式；trace 的落库逻辑和以前一样，不受这次改动影响。

    yield 的事件：
      {"type": "text_delta", "content": ...}                          最终回复的文字片段，实时的
      {"type": "tool_call", "id": ..., "name": ..., "args": ...}       工具调用请求
      {"type": "tool_result", "id": ..., "name": ..., "result": ...}   工具执行结果
      {"type": "final", "content": ..., "truncated": bool}             收尾，content 是这轮完整回复文本
    """
    conversation = list(messages)  # 不修改调用方传入的原始列表

    for step in range(MAX_STEPS):
        text_parts = []
        tool_calls = None

        async for event in ask_deepseek_with_tools_stream(conversation, TOOL_SCHEMAS):
            if event["type"] == "text_delta":
                text_parts.append(event["content"])
                yield {"type": "text_delta", "content": event["content"]}
            elif event["type"] == "tool_calls":
                tool_calls = event["calls"]
            # "done" 不用单独处理，纯文字的完整内容已经在 text_parts 里攒好了

        if tool_calls is None:
            final_text = "".join(text_parts)
            await _log_trace(db, session_id, turn_index, step, "final", None, {"content": final_text})
            yield {"type": "final", "content": final_text}
            return

        # 模型要求调用一个或多个工具：先把这条 assistant 消息（含 tool_calls）放回对话
        conversation.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {"id": call["id"], "type": "function",
                 "function": {"name": call["name"], "arguments": call["arguments"]}}
                for call in tool_calls
            ],
        })

        for call in tool_calls:
            name = call["name"]
            try:
                args = json.loads(call["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}

            await _log_trace(db, session_id, turn_index, step, "tool_call", name, {"args": args})
            yield {"type": "tool_call", "id": call["id"], "name": name, "args": args}

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
            yield {"type": "tool_result", "id": call["id"], "name": name, "result": result}

            conversation.append({
                "role": "tool",
                "tool_call_id": call["id"],
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })

    # 超过最大步数还没结束，兜底返回
    fallback = "处理这个请求需要的步骤太多了，我先停在这里，你可以换个更具体的说法重试。"
    await _log_trace(db, session_id, turn_index, MAX_STEPS, "final", None, {"content": fallback, "truncated": True})
    yield {"type": "final", "content": fallback, "truncated": True}


async def run_agent(db: AsyncSession, session_id: int, turn_index: int, messages: list) -> tuple[str, list]:
    """
    非流式包装，给不需要实时展示的调用方用（比如 /api/chat）：内部还是走 run_agent_stream，
    只是把事件收集完整了再一次性返回 (最终回复文本, trace 列表)，trace 里不包含 text_delta 这种中间片段。
    """
    trace = []
    reply = ""
    async for event in run_agent_stream(db, session_id, turn_index, messages):
        if event["type"] == "tool_call":
            trace.append({"type": "tool_call", "name": event["name"], "args": event["args"]})
        elif event["type"] == "tool_result":
            trace.append({"type": "tool_result", "name": event["name"], "result": event["result"]})
        elif event["type"] == "final":
            reply = event["content"]
            entry = {"type": "final", "content": reply}
            if event.get("truncated"):
                entry["truncated"] = True
            trace.append(entry)
    return reply, trace
