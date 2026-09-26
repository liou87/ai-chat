# Vercel 的 Python 函数入口：/api/* 的请求由 vercel.json 里的 rewrite 转到这里，
# 应用本身还是根目录 main.py 里的那个 FastAPI app（路由都带 /api 前缀），本地开发照旧用 uvicorn main:app
import os
import sys

# 函数从 api/ 目录加载，显式把项目根目录放进导入路径，保证 main、routers、services 这些包都能找到
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402,F401
