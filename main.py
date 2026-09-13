import os
import logging
from contextlib import asynccontextmanager

# 尽早配置日志，确保各模块创建的 logger 都能输出
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.chat import router as chat_router
from routers.sessions import router as sessions_router
from routers.tasks import router as tasks_router
from routers.notes import router as notes_router
from routers.reminders import router as reminders_router
from database import init_db
from services.scheduler import start_scheduler, stop_scheduler

# 默认允许的前端地址，可通过环境变量 ALLOWED_ORIGINS（逗号分隔）覆盖
DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "https://ai-chat-frontend-liard.vercel.app",
]
origins_env = os.getenv("ALLOWED_ORIGINS")
allowed_origins = [o.strip() for o in origins_env.split(",")] if origins_env else DEFAULT_ORIGINS


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(lifespan=lifespan)

# 只允许指定前端域名跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id", "X-Tool-Used"],
)

app.include_router(chat_router, prefix="/api")
app.include_router(sessions_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")
