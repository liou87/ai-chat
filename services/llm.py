from openai import OpenAI
from dotenv import load_dotenv
import os

# 加载 .env 文件中的环境变量
load_dotenv()

# 创建 DeepSeek 客户端
# DeepSeek 兼容 OpenAI SDK，所以用 OpenAI 类，只需把 base_url 指向 DeepSeek 服务器
client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),  # 从环境变量读取 API Key，不硬编码
    base_url="https://api.deepseek.com"
)

def ask_deepseek(message: str) -> str:
    """
    发送一条消息给 DeepSeek，返回 AI 的回复。
    
    参数：
        message: 用户输入的文字
    返回：
        AI 回复的文字
    """
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": message}]  # role=user 表示这是用户说的话
    )
    return response.choices[0].message.content  # 取出 AI 回复的文字内容