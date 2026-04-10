from openai import AsyncOpenAI
from dotenv import load_dotenv
import os
import asyncio

load_dotenv()

client = AsyncOpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

async def fetch_multiple(message):
    result = await ask_deepseek([{"role": "user", "content": message}])
    return result


async def ask_deepseek(messages: list) -> str:
    """
    发送消息历史给 DeepSeek，返回 AI 的回复。
    
    参数：
        messages: 消息列表，格式 [{"role": "user", "content": "..."}, ...]
    返回：
        AI 回复的文字
    """
    response = await client.chat.completions.create(
        model="deepseek-chat",
        messages=messages  # 直接传整个历史
    )
    return response.choices[0].message.content

