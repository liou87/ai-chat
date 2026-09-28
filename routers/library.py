from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from services.auth import verify_api_key
from services import library as library_service
from database import SessionLocal

router = APIRouter(dependencies=[Depends(verify_api_key)])


class AddUrlRequest(BaseModel):
    url: str
    title: Optional[str] = None
    source: str = "web"             # hot_topic（热点里点收藏）/ web / github
    summary: Optional[str] = None   # 热点里知行写的一句话理由，一起存进正文


@router.get("/library")
async def list_library():
    async with SessionLocal() as db:
        return await library_service.list_library(db)


@router.post("/library/url")
async def add_url(request: AddUrlRequest):
    async with SessionLocal() as db:
        try:
            return await library_service.add_url(db, request.url, title=request.title, source=request.source,
                                                 summary=request.summary)
        except library_service.ImportError_ as e:
            raise HTTPException(status_code=400, detail=str(e))


# PDF 直接用请求体传原始字节（Content-Type: application/pdf），文件名放在查询参数里，
# 不走 multipart 表单，省掉 python-multipart 这个依赖
@router.post("/library/pdf")
async def add_pdf(request: Request, filename: str = "未命名.pdf"):
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="没有收到文件内容")
    async with SessionLocal() as db:
        try:
            return await library_service.add_pdf(db, filename, data)
        except library_service.ImportError_ as e:
            raise HTTPException(status_code=400, detail=str(e))
