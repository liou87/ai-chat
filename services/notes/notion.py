import os
import asyncio
import logging
from datetime import datetime, timezone
import httpx
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession
from . import notes as notes_service

load_dotenv()

logger = logging.getLogger(__name__)

NOTION_API_KEY = os.getenv("NOTION_API_KEY")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")

NOTION_API = "https://api.notion.com/v1"
# 2025-09-03 起数据库查询走 data_sources 端点，旧的按 database id 查询的接口是废弃路径
NOTION_VERSION = "2025-09-03"

MAX_DEPTH = 3       # 嵌套内容（折叠块、缩进子项）最多往下读几层，防止结构很深时请求数失控
MAX_RETRIES = 3     # 遇到 429 限流最多重试几次

# 标题在文本前加对应数量的井号，services/chunking.py 靠这个标记把不同小节切开
HEADING_PREFIX = {"heading_1": "# ", "heading_2": "## ", "heading_3": "### "}
# 子页面和子数据库不同步，也不进入它们的内容
SKIP_TYPES = {"child_page", "child_database"}

if not NOTION_API_KEY or not NOTION_DATABASE_ID:
    logger.warning("未设置 NOTION_API_KEY 或 NOTION_DATABASE_ID，Notion 同步会返回错误提示而不是崩溃")


async def _request(client: httpx.AsyncClient, method: str, path: str, **kwargs) -> dict:
    """发一次 Notion 请求。遇到 429 限流按 Retry-After 等待后重试，最多 MAX_RETRIES 次。"""
    for attempt in range(MAX_RETRIES + 1):
        resp = await client.request(method, f"{NOTION_API}{path}", **kwargs)
        if resp.status_code == 429 and attempt < MAX_RETRIES:
            try:
                wait = float(resp.headers.get("Retry-After", 1))
            except ValueError:
                wait = 1.0
            logger.warning(f"Notion 限流，{wait} 秒后重试（第 {attempt + 1} 次）")
            await asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()


async def _paginate(client: httpx.AsyncClient, method: str, path: str) -> list:
    """把 Notion 的游标分页接口读完，返回所有 results。"""
    results = []
    cursor = None
    while True:
        payload = {"page_size": 100}
        if cursor:
            payload["start_cursor"] = cursor
        if method == "GET":
            data = await _request(client, "GET", path, params=payload)
        else:
            data = await _request(client, method, path, json=payload)
        results.extend(data["results"])
        if not data.get("has_more"):
            return results
        cursor = data["next_cursor"]


def _plain(rich_text) -> str:
    return "".join(t.get("plain_text", "") for t in rich_text or [])


async def _table_lines(client: httpx.AsyncClient, table_id: str) -> list:
    """表格 block 本身没有文字，要再请求一次拿到每一行，单元格文字用 " | " 连成一行。"""
    lines = []
    for row in await _paginate(client, "GET", f"/blocks/{table_id}/children"):
        cells = row.get("table_row", {}).get("cells", [])
        line = " | ".join(_plain(cell) for cell in cells)
        if line.strip(" |"):
            lines.append(line)
    return lines


async def _block_lines(client: httpx.AsyncClient, block_id: str, depth: int = 0) -> list:
    """
    读取一个页面（或 block）下的文字，返回按顺序排好的行。
    凡是带 rich_text 的文字类 block 统一处理（段落、标题、列表、引用、待办、代码、折叠块、标注块等），
    没有正文文字的（图片、书签等）自然被跳过；有子内容的继续往下读，子内容接在父块文字后面。
    """
    lines = []
    for block in await _paginate(client, "GET", f"/blocks/{block_id}/children"):
        block_type = block["type"]
        if block_type in SKIP_TYPES:
            continue
        if block_type == "table":
            lines.extend(await _table_lines(client, block["id"]))
            continue

        text = _plain(block.get(block_type, {}).get("rich_text"))
        if text:
            lines.append(HEADING_PREFIX.get(block_type, "") + text)
        if block.get("has_children") and depth < MAX_DEPTH:
            lines.extend(await _block_lines(client, block["id"], depth + 1))
    return lines


async def _get_data_source_id(client: httpx.AsyncClient) -> str:
    data = await _request(client, "GET", f"/databases/{NOTION_DATABASE_ID}")
    sources = data.get("data_sources") or []
    if not sources:
        raise ValueError("这个数据库下没有 data source")
    return sources[0]["id"]


def _page_title(page: dict) -> str:
    # 按类型找标题属性，而不是按名字：默认叫 Name 的属性常被改名，但 title 类型的属性有且只有一个
    for prop in page.get("properties", {}).values():
        if prop.get("type") == "title":
            return _plain(prop.get("title"))[:200] or "无标题"   # notes.title 是 varchar(200)
    return "无标题"


def _parse_time(value: str) -> datetime:
    """Notion 的时间是带 Z 的 UTC，转成不带时区的 UTC 存库，和 external_updated_at 列一致。"""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)


def _explain(error: httpx.HTTPStatusError) -> str:
    status = error.response.status_code
    if status == 401:
        return "Notion 拒绝了请求，NOTION_API_KEY 可能无效"
    if status in (403, 404):
        return "找不到这个 Notion 数据库，请检查 NOTION_DATABASE_ID，并确认已在数据库页面把它授权给集成"
    if status == 429:
        return "Notion 限流，重试多次仍失败，请稍后再试"
    return f"Notion 返回了错误（HTTP {status}）"


async def _sync_page(client: httpx.AsyncClient, db: AsyncSession, page: dict) -> str:
    """同步一个页面，返回 imported / updated / skipped。"""
    page_id = page["id"]
    edited_at = _parse_time(page["last_edited_time"])

    existing = await notes_service.get_note_by_external_id(db, page_id)
    if existing and existing.external_updated_at and existing.external_updated_at >= edited_at:
        return "skipped"   # 没改过，不拉正文也不重新算向量

    title = _page_title(page)
    content = "\n".join(await _block_lines(client, page_id))
    _, created = await notes_service.upsert_note_from_external(db, page_id, title, content, edited_at)
    return "imported" if created else "updated"


async def sync_notion_notes(db: AsyncSession) -> dict:
    """
    把指定 Notion 数据库里的页面导入/更新到 notes 表（只读，不会改动 Notion）。
    Notion 里已经查不到的页面（删了或移出了这个数据库），对应的本地副本也会删掉。
    返回 {imported, updated, skipped, failed, deleted}；配置缺失或 Notion 整体不可用时多一个 error 字段。
    """
    if not NOTION_API_KEY or not NOTION_DATABASE_ID:
        return {"error": "Notion 集成未配置（缺少 NOTION_API_KEY 或 NOTION_DATABASE_ID），无法同步"}

    stats = {"imported": 0, "updated": 0, "skipped": 0, "failed": 0, "deleted": 0}
    headers = {"Authorization": f"Bearer {NOTION_API_KEY}", "Notion-Version": NOTION_VERSION}

    try:
        async with httpx.AsyncClient(timeout=30, headers=headers) as client:
            data_source_id = await _get_data_source_id(client)
            pages = await _paginate(client, "POST", f"/data_sources/{data_source_id}/query")
            logger.info(f"Notion 同步开始，共 {len(pages)} 个页面")

            # 逐个页面按顺序处理，不并发；每处理完一个就提交，中途失败时已成功的部分保留
            for page in pages:
                try:
                    outcome = await _sync_page(client, db, page)
                except Exception:
                    logger.error(f"同步 Notion 页面失败：{page.get('id')}", exc_info=True)
                    await db.rollback()
                    outcome = "failed"
                stats[outcome] += 1

            # 只有页面列表完整读完才会走到这里；读取中途出错会跳到下面的 except，不会误删。
            # 同步失败的页面仍在列表里，所以不会因为拉正文失败而被删掉
            stats["deleted"] = await notes_service.delete_missing_external(db, "notion", [p["id"] for p in pages])
    except httpx.HTTPStatusError as e:
        logger.error("Notion 请求失败", exc_info=True)
        return {"error": _explain(e), **stats}
    except Exception:
        logger.error("Notion 同步失败", exc_info=True)
        return {"error": "同步 Notion 失败，请检查网络后再试", **stats}

    logger.info(f"Notion 同步完成：{stats}")
    return stats
