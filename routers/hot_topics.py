from fastapi import APIRouter, Depends
from services.auth import verify_api_key
from services import hot_topics as hot_topics_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.get("/hot-topics/today")
async def get_today_hot_topics():
    async with SessionLocal() as db:
        return await hot_topics_service.get_or_create_today_topics(db)
