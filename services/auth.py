import os
import logging
from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv()

logger = logging.getLogger(__name__)

API_KEY = os.getenv("API_KEY")

if not API_KEY:
    logger.warning("未设置 API_KEY 环境变量，接口暂不做鉴权（仅建议本地开发时这样）")


async def verify_api_key(x_api_key: str = Header(default=None, alias="X-API-Key")):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="无效的 API Key")
