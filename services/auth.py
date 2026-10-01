"""
登录鉴权：单用户密码 + 数据库会话。

- 密码只以 scrypt 哈希的形式放在环境变量 APP_PASSWORD_HASH 里（用 scripts/hash_password.py 生成），服务器不存明文。
- 登录成功后发一个随机令牌放进 httpOnly cookie，库里（auth_sessions）只存令牌的 sha256。
  有效期 30 天，前端每次打开会调 /auth/me 顺延，常用就不用重新登录。
- 同一 IP 15 分钟内连错 5 次就锁 15 分钟；全局一小时内失败超过 30 次暂停所有登录，防换 IP 爆破。
- 环境变量 API_KEY 仍然可以用（请求头 X-API-Key），只给脚本、外部定时器这类不经过浏览器的调用；
  它不再进前端代码。
- 两个变量都没配时不做鉴权，只建议本地开发这样。
"""
import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from datetime import timedelta
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from database import AuthSession, LoginAttempt, SessionLocal
from services import clock

load_dotenv()

logger = logging.getLogger(__name__)

API_KEY = os.getenv("API_KEY")
PASSWORD_HASH = os.getenv("APP_PASSWORD_HASH")
AUTH_ENABLED = bool(API_KEY or PASSWORD_HASH)

COOKIE_NAME = "zx_session"
SESSION_DAYS = 30
REFRESH_AFTER = timedelta(hours=1)        # 距上次顺延超过这么久才写库，免得每个请求都写
IP_MAX_FAILURES = 5
IP_LOCK_MINUTES = 15
GLOBAL_MAX_FAILURES_PER_HOUR = 30
CACHE_SECONDS = 60     # 校验过的令牌在当前函数实例里缓存这么久，少一次查库；被踢下线的设备最多晚这么久失效

# scrypt 参数：n=2^14、r=8 约占 16MB 内存，单次校验几十毫秒，对爆破足够慢
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1

if not AUTH_ENABLED:
    logger.warning("没有配置 APP_PASSWORD_HASH 和 API_KEY，接口暂不做鉴权（仅建议本地开发时这样）")

_token_cache: dict[str, tuple[int, float]] = {}   # 令牌哈希 -> (会话 id, 缓存到期的时间戳)


class LoginError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected), maxmem=64 * 1024 * 1024)
    except (ValueError, TypeError):
        logger.error("APP_PASSWORD_HASH 格式不对，重新用 scripts/hash_password.py 生成")
        return False
    return hmac.compare_digest(actual, expected)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def client_ip(request: Request) -> str:
    # Vercel 会把真实客户端 IP 写进 x-forwarded-for（覆盖客户端自己带的），本地开发时取连接地址
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def is_secure(request: Request) -> bool:
    return bool(os.getenv("VERCEL")) or request.url.scheme == "https"


async def _check_rate_limit(db: AsyncSession, ip: str):
    now = clock.now()
    ip_failures = (await db.execute(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.ip == ip, LoginAttempt.success.is_(False),
            LoginAttempt.created_at >= now - timedelta(minutes=IP_LOCK_MINUTES),
        )
    )).scalar()
    if ip_failures >= IP_MAX_FAILURES:
        raise LoginError(f"密码错误次数太多，{IP_LOCK_MINUTES} 分钟后再试", status=429)
    global_failures = (await db.execute(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.success.is_(False), LoginAttempt.created_at >= now - timedelta(hours=1),
        )
    )).scalar()
    if global_failures >= GLOBAL_MAX_FAILURES_PER_HOUR:
        logger.warning("一小时内登录失败次数超过上限，暂停登录")
        raise LoginError("登录失败次数异常，已暂停登录，过一小时再试", status=429)


async def login(db: AsyncSession, password: str, ip: str, user_agent: str | None) -> str:
    """校验密码，成功返回新会话的令牌（明文，只放进 cookie）。"""
    if not PASSWORD_HASH:
        raise LoginError("服务器没有配置登录密码（APP_PASSWORD_HASH）", status=503)
    await _check_rate_limit(db, ip)
    ok = verify_password(password, PASSWORD_HASH)
    db.add(LoginAttempt(ip=ip, success=ok))
    if not ok:
        await db.commit()
        raise LoginError("密码不对")

    now = clock.now()
    # 顺手清理：过期的会话、一天前的登录记录
    await db.execute(delete(AuthSession).where(AuthSession.expires_at < now))
    await db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < now - timedelta(days=1)))
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(
        token_hash=_hash_token(token), ip=ip, user_agent=(user_agent or "")[:300],
        created_at=now, last_seen_at=now, expires_at=now + timedelta(days=SESSION_DAYS),
    ))
    await db.commit()
    return token


async def get_session(db: AsyncSession, token: str | None) -> AuthSession | None:
    if not token:
        return None
    row = (await db.execute(select(AuthSession).where(AuthSession.token_hash == _hash_token(token)))).scalars().first()
    if row is None or row.expires_at < clock.now():
        return None
    return row


async def touch(db: AsyncSession, row: AuthSession, ip: str) -> bool:
    """顺延会话有效期。距上次顺延不到一小时就跳过，返回是否真的顺延了。"""
    now = clock.now()
    if row.last_seen_at and now - row.last_seen_at < REFRESH_AFTER:
        return False
    row.last_seen_at = now
    row.ip = ip
    row.expires_at = now + timedelta(days=SESSION_DAYS)
    await db.commit()
    return True


async def list_sessions(db: AsyncSession, current_token: str | None) -> list[dict]:
    current_hash = _hash_token(current_token) if current_token else None
    rows = (await db.execute(
        select(AuthSession).where(AuthSession.expires_at >= clock.now()).order_by(AuthSession.last_seen_at.desc())
    )).scalars().all()
    return [{
        "id": r.id, "user_agent": r.user_agent, "ip": r.ip,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
        "current": r.token_hash == current_hash,
    } for r in rows]


async def revoke(db: AsyncSession, session_id: int | None = None, token: str | None = None,
                 all_except_token: str | None = None) -> int:
    """删会话：按 id、按令牌（退出当前设备），或者除了当前设备之外全部删掉。返回删了几条。"""
    stmt = delete(AuthSession)
    if session_id is not None:
        stmt = stmt.where(AuthSession.id == session_id)
    elif token is not None:
        stmt = stmt.where(AuthSession.token_hash == _hash_token(token))
    elif all_except_token is not None:
        stmt = stmt.where(AuthSession.token_hash != _hash_token(all_except_token))
    result = await db.execute(stmt)
    await db.commit()
    _token_cache.clear()
    return result.rowcount or 0


async def require_auth(request: Request):
    """所有业务接口的依赖：认登录 cookie，或者请求头里的 API_KEY。"""
    if not AUTH_ENABLED:
        return
    key = request.headers.get("x-api-key")
    if API_KEY and key and hmac.compare_digest(key, API_KEY):
        return
    token = request.cookies.get(COOKIE_NAME)
    if token:
        token_hash = _hash_token(token)
        cached = _token_cache.get(token_hash)
        if cached and cached[1] > time.monotonic():
            return
        async with SessionLocal() as db:
            row = await get_session(db, token)
        if row is not None:
            _token_cache[token_hash] = (row.id, time.monotonic() + CACHE_SECONDS)
            return
    raise HTTPException(status_code=401, detail="请先登录")
