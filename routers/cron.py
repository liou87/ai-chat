import logging
import os
from fastapi import APIRouter, Header, HTTPException
from database import SessionLocal
from services import digest as digest_service
from services import hot_topics as hot_topics_service

logger = logging.getLogger(__name__)

# 给 Vercel Cron 调的入口（配置在 vercel.json 的 crons 里），部署在 Vercel 上时替代 APScheduler 的每日任务。
# 不走 X-API-Key：Vercel 调 cron 时会带上 Authorization: Bearer <CRON_SECRET>，
# CRON_SECRET 是在 Vercel 项目环境变量里配的随机字符串，没配的话这个接口直接拒绝，免得被人随便触发生成
router = APIRouter()


@router.get("/cron/daily")
async def daily(authorization: str | None = Header(default=None)):
    secret = os.getenv("CRON_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="没有配置 CRON_SECRET")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="unauthorized")

    # 两件事互不影响：一个失败不耽误另一个；都是"今天没有才生成"，重复调用不会重复花钱
    result = {}
    async with SessionLocal() as db:
        try:
            digest = await digest_service.get_or_create_today_digest(db)
            result["digest"] = digest["digest_date"]
        except Exception:
            logger.error("cron 生成每日简报失败", exc_info=True)
            result["digest"] = "failed"
    async with SessionLocal() as db:
        try:
            topics = await hot_topics_service.get_or_create_today_topics(db)
            result["hot_topics"] = len(topics["items"])
        except Exception:
            logger.error("cron 生成 AI 热点失败", exc_info=True)
            result["hot_topics"] = "failed"
    return result
