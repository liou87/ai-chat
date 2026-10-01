from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from database import SessionLocal
from services import auth as auth_service

# 登录相关接口。login / me 不挂 require_auth（没登录也要能调），其余在各自的路由上单独挂
router = APIRouter()


class LoginRequest(BaseModel):
    password: str


def _set_cookie(response: Response, request: Request, token: str):
    response.set_cookie(
        auth_service.COOKIE_NAME, token,
        max_age=auth_service.SESSION_DAYS * 24 * 3600,
        httponly=True,                       # 页面上的 JS 读不到
        secure=auth_service.is_secure(request),
        samesite="strict",                   # 别的网站发起的请求不带这个 cookie，顺带挡掉 CSRF
        path="/api",
    )


def _clear_cookie(response: Response, request: Request):
    response.delete_cookie(auth_service.COOKIE_NAME, path="/api", secure=auth_service.is_secure(request),
                           httponly=True, samesite="strict")


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, response: Response):
    async with SessionLocal() as db:
        try:
            token = await auth_service.login(
                db, body.password, auth_service.client_ip(request), request.headers.get("user-agent"),
            )
        except auth_service.LoginError as e:
            raise HTTPException(status_code=e.status, detail=str(e))
    _set_cookie(response, request, token)
    return {"ok": True}


@router.get("/auth/me")
async def me(request: Request, response: Response):
    """前端启动时调：判断要不要显示登录页，已登录就顺延有效期（cookie 也一起续上 30 天）。"""
    if not auth_service.AUTH_ENABLED:
        return {"authenticated": True, "auth_required": False}
    token = request.cookies.get(auth_service.COOKIE_NAME)
    async with SessionLocal() as db:
        row = await auth_service.get_session(db, token)
        if row is None:
            return {"authenticated": False, "auth_required": True}
        if await auth_service.touch(db, row, auth_service.client_ip(request)):
            _set_cookie(response, request, token)
    return {"authenticated": True, "auth_required": True}


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(auth_service.COOKIE_NAME)
    if token:
        async with SessionLocal() as db:
            await auth_service.revoke(db, token=token)
    _clear_cookie(response, request)
    return {"ok": True}


@router.get("/auth/sessions", dependencies=[Depends(auth_service.require_auth)])
async def list_sessions(request: Request):
    async with SessionLocal() as db:
        return await auth_service.list_sessions(db, request.cookies.get(auth_service.COOKIE_NAME))


@router.delete("/auth/sessions/{session_id}", dependencies=[Depends(auth_service.require_auth)])
async def revoke_session(session_id: int):
    async with SessionLocal() as db:
        if not await auth_service.revoke(db, session_id=session_id):
            raise HTTPException(status_code=404, detail="这个登录已经不存在了")
    return {"ok": True}


@router.post("/auth/sessions/revoke-others", dependencies=[Depends(auth_service.require_auth)])
async def revoke_others(request: Request):
    """除了当前这台设备，其它登录全部下线。"""
    token = request.cookies.get(auth_service.COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=400, detail="当前不是用登录 cookie 访问的")
    async with SessionLocal() as db:
        count = await auth_service.revoke(db, all_except_token=token)
    return {"revoked": count}
