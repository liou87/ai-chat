from fastapi import APIRouter, Depends
from services.auth import verify_api_key
from services import digest as digest_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.get("/digest/today")
async def get_today_digest():
    async with SessionLocal() as db:
        return await digest_service.get_or_create_today_digest(db)
