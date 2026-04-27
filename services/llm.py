from openai import AsyncOpenAI
from dotenv import load_dotenv
import os
import logging
from fastapi.responses import StreamingResponse

load_dotenv()

logger = logging.getLogger(__name__)

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
            model="deepseek-chat",
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
        model="deepseek-chat",
        messages=messages,
        stream=True  # 开启流式
    )
    async for chunk in response:
        content = chunk.choices[0].delta.content
        if content:
            yield content  # 每次 yield 一小块文字