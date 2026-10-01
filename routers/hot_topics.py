from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from services.auth import require_auth
from services import hot_topics as hot_topics_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(require_auth)])


@router.get("/hot-topics/today")
async def get_today_hot_topics():
    async with SessionLocal() as db:
        return await hot_topics_service.get_or_create_today_topics(db)


@router.post("/hot-topics/today/regenerate")
async def regenerate_today_hot_topics():
    async with SessionLocal() as db:
        return await hot_topics_service.regenerate_today_topics(db)


# 注意要声明在 /hot-topics/{day} 前面，不然 "dates" 会被当成日期参数去解析
@router.get("/hot-topics/dates")
async def get_hot_topic_dates():
    async with SessionLocal() as db:
        return await hot_topics_service.list_topic_dates(db)


@router.get("/hot-topics/{day}")
async def get_hot_topics_by_date(day: date):
    async with SessionLocal() as db:
        result = await hot_topics_service.get_topics_by_date(db, day)
        if result is None:
            raise HTTPException(status_code=404, detail="这一天没有热点记录")
        return result
