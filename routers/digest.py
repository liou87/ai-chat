from fastapi import APIRouter, Depends
from services.auth import require_auth
from services import digest as digest_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(require_auth)])


@router.get("/digest/today")
async def get_today_digest():
    async with SessionLocal() as db:
        return await digest_service.get_or_create_today_digest(db)


@router.post("/digest/today/regenerate")
async def regenerate_today_digest():
    async with SessionLocal() as db:
        return await digest_service.regenerate_today_digest(db)
