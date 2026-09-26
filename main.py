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
from routers.digest import router as digest_router
from routers.goals import router as goals_router
from routers.hot_topics import router as hot_topics_router
from routers.cron import router as cron_router
from database import init_db, ON_VERCEL
from services.scheduler import start_scheduler, stop_scheduler

# 默认允许的前端地址，可通过环境变量 ALLOWED_ORIGINS（逗号分隔）覆盖。
# 部署在 Vercel 上时前端和后端同一个域名（/api 由 Python 函数处理），不存在跨域，
# 这里只需要放行本地开发的 Vite 地址
DEFAULT_ORIGINS = [
    "http://localhost:5173",
]
origins_env = os.getenv("ALLOWED_ORIGINS")
allowed_origins = [o.strip() for o in origins_env.split(",")] if origins_env else DEFAULT_ORIGINS


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Vercel 上没有常驻进程，APScheduler 起不了作用：提醒到期改在 /reminders/due 轮询时顺手检查，
    # 简报和热点由 vercel.json 里的每日 cron 调 /api/cron/daily 预生成（当天第一次打开页面时也会现生成）。
    # pgvector 扩展早就建好了，每次冷启动再执行一遍没必要，也只在本地常驻进程里跑。
    if ON_VERCEL:
        yield
        return
    await init_db()
    start_scheduler()
    yield
    stop_scheduler()


# 接口文档也放在 /api 下面：线上只有 /api/* 会转给 Python 函数，放在默认的 /docs 会被当成前端页面
app = FastAPI(lifespan=lifespan, docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")

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
app.include_router(digest_router, prefix="/api")
app.include_router(goals_router, prefix="/api")
app.include_router(hot_topics_router, prefix="/api")
app.include_router(cron_router, prefix="/api")
