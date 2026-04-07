from fastapi import FastAPI
from routers.chat import router as chat_router

# 创建主应用
app = FastAPI()

# 把 chat 路由挂载到主 app
# prefix="/api" 表示所有 chat 路由前面加 /api
# 所以接口地址变成 /api/chat
app.include_router(chat_router, prefix="/api")