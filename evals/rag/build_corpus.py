"""
按 manifest.yaml 抓取检索评测语料，存到 evals/rag/corpus/<id>.md。

    python -m evals.rag.build_corpus            抓还没有本地快照的文档
    python -m evals.rag.build_corpus --refresh  全部重抓（网页文章会变，重抓后要检查标注）

GitHub 仓库：第一次抓时把默认分支当前的提交号写回 manifest 的 ref，之后都按这个提交取 README，内容固定。
网页文章：用 Tavily Extract 抓正文（跟线上资料库导入同一套去导航逻辑），无法固定版本，本地快照就是标准。
"""
import argparse
import asyncio
import re
import sys
from pathlib import Path

import httpx
import yaml

from services import library as library_service

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.yaml"
CORPUS = ROOT / "corpus"
MAX_CHARS = 30000   # 超长 README 只取前 3 万字，控制分块数量和向量成本


async def _github(client: httpx.AsyncClient, doc: dict) -> tuple[str, str]:
    repo = doc["repo"]
    if not doc.get("ref"):
        r = await client.get(f"https://api.github.com/repos/{repo}/commits/HEAD",
                             headers={"Accept": "application/vnd.github+json"})
        r.raise_for_status()
        doc["ref"] = r.json()["sha"]
    r = await client.get(f"https://api.github.com/repos/{repo}/readme", params={"ref": doc["ref"]},
                         headers={"Accept": "application/vnd.github.raw"})
    r.raise_for_status()
    return repo, r.text


async def _web(doc: dict) -> tuple[str, str]:
    content = library_service._strip_leading_nav(await library_service._fetch_web(doc["url"]))
    return doc["title"], content


def _save_manifest(manifest: dict) -> None:
    # 保留文件头的注释，只重写 docs 部分；每条一行，跟手写的格式一致
    header = MANIFEST.read_text(encoding="utf-8").split("docs:")[0]
    lines = [header + "docs:"]
    for d in manifest["docs"]:
        fields = ", ".join(f"{k}: {yaml.safe_dump(v, allow_unicode=True, default_flow_style=True).strip().removesuffix('...').strip()}"
                           for k, v in d.items())
        lines.append(f"  - {{{fields}}}")
    MANIFEST.write_text("\n".join(lines) + "\n", encoding="utf-8")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    manifest = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    CORPUS.mkdir(exist_ok=True)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for doc in manifest["docs"]:
            path = CORPUS / f"{doc['id']}.md"
            if path.exists() and not args.refresh:
                continue
            try:
                title, content = await (_github(client, doc) if doc["kind"] == "github" else _web(doc))
            except Exception as e:
                print(f"✗ {doc['id']}: {type(e).__name__} {e}")
                continue
            content = re.sub(r"\n{3,}", "\n\n", content).strip()[:MAX_CHARS]
            path.write_text(f"# {title}\n\n{content}\n", encoding="utf-8")
            print(f"✓ {doc['id']}: {len(content):,} 字")
    _save_manifest(manifest)


if __name__ == "__main__":
    asyncio.run(main())
