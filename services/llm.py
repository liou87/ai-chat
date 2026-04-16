from openai import AsyncOpenAI
from dotenv import load_dotenv
import os

load_dotenv()

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
    c = get_client()
    response = await c.chat.completions.create(
        model="deepseek-chat",
        messages=messages
    )
    return response.choices[0].message.content