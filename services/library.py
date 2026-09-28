"""
资料库：收藏的热点、导入的网页、GitHub 仓库和 PDF。

跟笔记共用 notes / note_chunks 两张表和同一套分块、向量、检索（category="library"），
所以知行检索知识库时资料库会一起被搜到；区别只在来源（source）和原文链接（url）。
网页正文用 Tavily Extract 抓，GitHub 仓库直接用 GitHub API 拿 README，PDF 用 pypdf 在后端提取文字。
"""
import io
import logging
import os
import re
from typing import Optional
from urllib.parse import urlparse
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import Note
from services.notes import notes as notes_service

logger = logging.getLogger(__name__)

CATEGORY = "library"
SOURCES = ("hot_topic", "web", "github", "pdf")
MAX_CONTENT_CHARS = 60000     # 超长网页/论文只保留前 6 万字，分块和算向量的成本可控
MAX_PDF_BYTES = 4 * 1024 * 1024   # Vercel 请求体上限 4.5MB，留点余量
PREVIEW_CHARS = 400
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"
GITHUB_REPO_RE = re.compile(r"^https?://(www\.)?github\.com/([^/\s]+)/([^/\s#?]+)", re.I)


class ImportError_(Exception):
    """抓取/解析失败，消息直接给用户看。（避开内置的 ImportError 名字）"""


def _serialize(note: Note) -> dict:
    content = note.content or ""
    return {
        "id": note.id,
        "title": note.title,
        "source": note.source,
        "url": note.url,
        "domain": urlparse(note.url).netloc.removeprefix("www.") if note.url else None,
        "preview": content[:PREVIEW_CHARS],
        "length": len(content),
        "created_at": note.created_at.isoformat() if note.created_at else None,
    }


async def list_library(db: AsyncSession) -> list[dict]:
    """资料库列表只给预览，不给全文（全文可能几万字）；要看全文走 GET /notes/{id}。"""
    rows = (await db.execute(
        select(Note).where(Note.category == CATEGORY).order_by(Note.created_at.desc())
    )).scalars().all()
    return [_serialize(n) for n in rows]


async def _find_by_url(db: AsyncSession, url: str) -> Optional[Note]:
    return (await db.execute(
        select(Note).where(Note.category == CATEGORY, Note.url == url)
    )).scalars().first()


async def _fetch_github_readme(owner: str, repo: str) -> tuple[str, str]:
    async with httpx.AsyncClient(timeout=20) as client:
        info = await client.get(f"https://api.github.com/repos/{owner}/{repo}", headers={"Accept": "application/vnd.github+json"})
        readme = await client.get(f"https://api.github.com/repos/{owner}/{repo}/readme", headers={"Accept": "application/vnd.github.raw"})
    if readme.status_code == 404:
        raise ImportError_("这个仓库没有 README")
    readme.raise_for_status()
    description = info.json().get("description") if info.status_code == 200 else None
    header = f"{owner}/{repo}" + (f"：{description}" if description else "")
    return f"{owner}/{repo}", f"{header}\n\n{readme.text}"


async def _fetch_web(url: str) -> str:
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        raise ImportError_("没有配置 TAVILY_API_KEY，抓不了网页")
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            TAVILY_EXTRACT_URL,
            json={"urls": [url], "format": "markdown", "extract_depth": "basic"},
            headers={"Authorization": f"Bearer {key}"},
        )
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results") or []
    if not results or not (results[0].get("raw_content") or "").strip():
        failed = (data.get("failed_results") or [{}])[0].get("error")
        raise ImportError_(f"没能抓到这个网页的正文{f'（{failed}）' if failed else ''}")
    return results[0]["raw_content"]


async def _page_title(url: str) -> Optional[str]:
    """读网页自带的标题（og:title 优先，其次 <title>）。只读前 200KB，失败返回 None。"""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as client:
            resp = await client.get(url)
        html = resp.text[:200000]
    except Exception:
        return None
    m = (re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)', html, re.I)
         or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title', html, re.I)
         or re.search(r"<title[^>]*>([^<]+)</title>", html, re.I))
    if not m:
        return None
    import html as html_lib
    title = html_lib.unescape(m.group(1)).strip()
    # 去掉常见的"标题 | 站点名"后缀
    title = re.split(r"\s+[|\-–—]\s+(?=[^|\-–—]{1,30}$)", title)[0].strip()
    return title[:200] or None


def _markdown_heading(content: str) -> Optional[str]:
    for line in content.splitlines()[:40]:
        m = re.match(r"^\s*#{1,3}\s+(.+?)\s*#*\s*$", line)
        if m:
            return m.group(1)[:200]
    return None


def _strip_leading_nav(content: str) -> str:
    """
    网页正文开头常带一段导航菜单（一串很短的链接，比如"Home Open Source [AI Agents](...)"）。
    从开头跳过这种行，直到遇到第一行像正文的内容：标题行，或者去掉链接后还有 40 个字以上的行。
    找不到就原样返回，宁可留着导航也不误删正文。
    """
    lines = content.splitlines()
    for i, line in enumerate(lines[:150]):
        # 链接外面的纯文字：去掉图片、整个链接（连同文字）、裸网址和 Markdown 符号后剩下的部分。
        # 导航行几乎全是链接，剩不下什么；正文行即使夹着链接，链接外也有成句的文字
        outside = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", line)
        outside = re.sub(r"\[[^\]]*\]\([^)]*\)", "", outside)
        outside = re.sub(r"https?://\S+|[\[\]()!*_#>|\-]", "", outside).strip()
        heading = re.match(r"^\s*#{1,3}\s+(?!\[)", line) and len(outside) >= 8
        if heading or len(outside) >= 40:
            return "\n".join(lines[i:])
    return content


async def add_url(db: AsyncSession, url: str, title: Optional[str] = None, source: str = "web",
                  summary: Optional[str] = None) -> dict:
    """
    收藏一个链接：GitHub 仓库拿 README，其它网页用 Tavily 抓正文，分块算向量后存进资料库。
    同一个链接已经收藏过就直接返回那一条（带 existed=True），不重复抓。
    summary 是热点里知行写的一句话理由，放在正文最前面，检索时也能命中。
    """
    url = url.strip()
    if not re.match(r"^https?://", url):
        raise ImportError_("请输入以 http:// 或 https:// 开头的网址")
    existing = await _find_by_url(db, url)
    if existing:
        return {**_serialize(existing), "existed": True}

    gh = GITHUB_REPO_RE.match(url)
    try:
        if gh:
            repo_title, content = await _fetch_github_readme(gh.group(2), gh.group(3).removesuffix(".git"))
            title = title or repo_title
            source = "hot_topic" if source == "hot_topic" else "github"
        else:
            content = _strip_leading_nav(await _fetch_web(url))
            title = title or await _page_title(url) or _markdown_heading(content) or url[:200]
    except ImportError_:
        raise
    except Exception as e:
        logger.warning(f"抓取失败：{url}", exc_info=True)
        raise ImportError_(f"抓取失败：{e.__class__.__name__}") from e

    if summary:
        content = f"{summary}\n\n{content}"
    note = await notes_service.create_note(
        db, title=title, content=content[:MAX_CONTENT_CHARS], category=CATEGORY,
        source=source if source in SOURCES else "web", url=url,
    )
    return {**_serialize(await db.get(Note, note["id"])), "existed": False}


async def add_pdf(db: AsyncSession, filename: str, data: bytes) -> dict:
    """解析 PDF 文字存进资料库。扫描版（纯图片）PDF 提取不出文字，直接报错提示。"""
    if len(data) > MAX_PDF_BYTES:
        raise ImportError_("PDF 超过 4MB，线上环境传不上去，可以先压缩或者拆开")
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
    except Exception as e:
        logger.warning(f"PDF 解析失败：{filename}", exc_info=True)
        raise ImportError_("PDF 解析失败，文件可能损坏或者加了密") from e
    text = "\n\n".join(p for p in pages if p)
    if len(text) < 50:
        raise ImportError_("这个 PDF 里提取不到文字，可能是扫描版（图片）")
    meta_title = None
    try:
        meta_title = (reader.metadata.title or "").strip() if reader.metadata else None
    except Exception:
        pass
    title = meta_title or re.sub(r"\.pdf$", "", filename, flags=re.I) or "未命名 PDF"
    note = await notes_service.create_note(db, title=title[:200], content=text[:MAX_CONTENT_CHARS], category=CATEGORY, source="pdf")
    return {**_serialize(await db.get(Note, note["id"])), "existed": False, "pages": len(pages)}
