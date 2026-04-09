from fastapi import APIRouter
from pydantic import BaseModel
from services.llm import ask_deepseek
from typing import List


router = APIRouter()

# 单条消息的结构
class Message(BaseModel):
    role: str
    content: str

# 请求体：消息列表
class ChatRequest(BaseModel):
    messages: List[Message]

@router.post("/chat")
def chat(request: ChatRequest):
    # 把 Pydantic 对象转成字典列表，DeepSeek 需要的格式
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    reply = ask_deepseek(messages)
    return {"reply": reply}