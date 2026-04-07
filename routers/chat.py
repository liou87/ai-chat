from fastapi import APIRouter
from pydantic import BaseModel
from services.llm import ask_deepseek

# APIRouter 是 FastAPI 的路由模块
# 作用和 app 一样可以注册接口，但它是"子路由"，最终挂载到主 app 上
router = APIRouter()

# 定义请求体结构，message 必须是字符串
class ChatRequest(BaseModel):
    message: str

@router.post("/chat")
def chat(request: ChatRequest):
    # 调用 service 层，不在这里写业务逻辑
    reply = ask_deepseek(request.message)
    return {"reply": reply}