from openai import AsyncOpenAI
from dotenv import load_dotenv
import os
import logging

load_dotenv()

logger = logging.getLogger(__name__)

# deepseek-chat / deepseek-reasoner 已于 2026-07-24 被官方弃用，现用名见
# https://api-docs.deepseek.com/guides/tool_calls/
MODEL_NAME = "deepseek-flash"

# 不在模块级别创建客户端
client = None

def get_client():
    global client
    if client is None:
        client = AsyncOpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com"
        )
    return client


async def ask_deepseek_with_tools_stream(messages: list, tools: list):
    """
    带 function calling 的流式调用：调用前不知道模型这一步是要输出文字还是请求工具，
    所以统一用 stream=True 发一次请求，边收边判断，不用先猜再重发。

    是文字内容就实时 yield 出去（{"type": "text_delta", "content": ...}），前端能马上看到；
    是工具调用的话，参数是分片段流式给的（同一个 tool_call 的 arguments 分好几个 chunk 拼），
    这里攒完整了才一次性给出（{"type": "tool_calls", "calls": [...]}） ，因为半截 JSON 没法解析也没法执行。
    流结束时如果整段都是纯文字（没有工具调用），额外 yield 一次完整文本
    （{"type": "done", "content": ...}），方便调用方直接拿去存库，不用自己再拼一遍。
    最后这个事件（tool_calls 或 done）都带 usage：{"prompt_tokens", "completion_tokens"}，执行轨迹页用。
    """
    logger.info(f"发送带工具的流式请求，消息数：{len(messages)}，工具数：{len(tools)}")
    response = await get_client().chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        stream=True,
        # 流式默认不返回用量，打开后最后会多一个 choices 为空、只带 usage 的 chunk
        stream_options={"include_usage": True},
    )

    text_parts = []
    tool_calls = {}  # 按 delta.tool_calls[i].index 分组，同一个工具调用的 arguments 片段追加在一起
    usage = None

    async for chunk in response:
        if getattr(chunk, "usage", None):
            usage = {"prompt_tokens": chunk.usage.prompt_tokens, "completion_tokens": chunk.usage.completion_tokens}
        if not chunk.choices:   # 只带 usage 的最后一个 chunk
            continue
        delta = chunk.choices[0].delta

        if delta.content:
            text_parts.append(delta.content)
            yield {"type": "text_delta", "content": delta.content}

        for tc in delta.tool_calls or []:
            slot = tool_calls.setdefault(tc.index, {"id": None, "name": None, "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function and tc.function.name:
                slot["name"] = tc.function.name
            if tc.function and tc.function.arguments:
                slot["arguments"] += tc.function.arguments

    if tool_calls:
        yield {"type": "tool_calls", "calls": [tool_calls[i] for i in sorted(tool_calls)], "usage": usage}
    else:
        yield {"type": "done", "content": "".join(text_parts), "usage": usage}
