"""
第三层评测第一步：让知行端到端回答检索评测的题目（主题集 49 + 留出 12），记下回答和它当时拿到的资料。

    python -m evals.quality.generate_answers

跟线上走同一套系统提示和工具（run_agent），只是数据在 eval_rag schema（检索评测的语料），联网类工具用固定返回。
每条记录：题目、分组、知行调用了哪些工具、拿到的资料（search_notes 返回的标题和分块、联网搜索结果等）、最终回复。
输出到 evals/quality/answers.json（含语料片段，不进 git），之后人工标注和模型评分都基于这份。
"""
import os

os.environ["DB_SCHEMA"] = "eval_rag"   # 必须在 import database 之前

import asyncio
import json
import logging
import sys
from pathlib import Path

import yaml

from database import ChatSession, SessionLocal
from evals import fixtures, mocks
from evals.rag.run_rag_eval import QUERIES, load_corpus
from routers.chat import ChatRequest, MessageSchema, _build_messages
from services.agent import run_agent

ROOT = Path(__file__).resolve().parent
HOLDOUT = QUERIES.with_name("queries_holdout.yaml")
OUT = ROOT / "answers.json"


def _materials(trace: list) -> list[dict]:
    """把工具结果整理成评分时要看的"资料"：检索到的每篇标题和分块、联网搜索结果、读到的网页。"""
    out = []
    for t in trace:
        if t["type"] != "tool_result":
            continue
        r = t["result"] if isinstance(t["result"], dict) else {}
        if t["name"] == "search_notes":
            for n in r.get("notes", []):
                out.append({"tool": "search_notes", "title": n.get("title"), "content": "\n……\n".join(n.get("snippets") or [])})
        elif t["name"] == "web_search":
            for x in r.get("results", []):
                out.append({"tool": "web_search", "title": x.get("title") or "联网搜索", "content": x.get("content") or x.get("error") or ""})
        elif t["name"] == "search_memory":
            for m in r.get("memories", []):
                out.append({"tool": "search_memory", "title": m.get("session_title"), "content": m.get("content", "")})
        else:
            out.append({"tool": t["name"], "title": t["name"], "content": json.dumps(r, ensure_ascii=False)[:1500]})
    return out


async def main():
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.WARNING)
    await fixtures.assert_isolated("eval_rag")
    fixtures.freeze_clock()
    mocks.install()
    await load_corpus()

    queries = [{**q, "set": "main"} for q in yaml.safe_load(QUERIES.read_text(encoding="utf-8"))["queries"]]
    queries += [{**q, "set": "holdout"} for q in yaml.safe_load(HOLDOUT.read_text(encoding="utf-8"))["queries"]]
    answers = []
    for i, q in enumerate(queries, 1):
        try:
            async with SessionLocal() as db:
                session = ChatSession(title=f"[quality] {q['id']}")
                db.add(session)
                await db.commit()
                request = ChatRequest(session_id=session.id, messages=[MessageSchema(role="user", content=q["q"])])
                reply, trace = await run_agent(db, session.id, 0, await _build_messages(db, request))
            answers.append({
                "id": q["id"], "set": q["set"], "group": q["group"], "question": q["q"],
                "gold_docs": [g["doc"] for g in q.get("gold", [])],
                "tools": [t["name"] for t in trace if t["type"] == "tool_call"],
                "materials": _materials(trace), "reply": reply,
            })
            print(f"[{i}/{len(queries)}] ✓ {q['id']}", flush=True)
        except Exception as e:
            logging.exception(q["id"])
            print(f"[{i}/{len(queries)}] ✗ {q['id']} {type(e).__name__}", flush=True)
    OUT.write_text(json.dumps(answers, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"写入 {len(answers)} 条 → {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
