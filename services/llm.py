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


async def ask_deepseek(messages: list) -> str:
    logger.info(f"发送请求，消息数：{len(messages)}")
    try:
        response = await get_client().chat.completions.create(
            model=MODEL_NAME,
            messages=messages
        )
        reply = response.choices[0].message.content
        logger.info(f"收到回复，长度：{len(reply)}")
        return reply
    except Exception as e:
        logger.error(f"DeepSeek 调用失败：{e}")
        raise


async def ask_deepseek_stream(messages: list):
    """
    流式调用 DeepSeek,逐块返回内容。
    """
    logger.info(f"流式请求，消息数：{len(messages)}")
    response = await get_client().chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        stream=True  # 开启流式
    )
    async for chunk in response:
        content = chunk.choices[0].delta.content
        if content:
            yield content  # 每次 yield 一小块文字


async def ask_deepseek_with_tools(messages: list, tools: list):
    """
    带 function calling 的一次请求，返回原始 response message
    （可能带 tool_calls，也可能是最终的自然语言回复）。
    """
    logger.info(f"发送带工具的请求，消息数：{len(messages)}，工具数：{len(tools)}")
    response = await get_client().chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        tools=tools,
        tool_choice="auto"
    )
    return response.choices[0].message
