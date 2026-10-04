"""
知行检索评测：直接调线上同一个 search_notes（分块、向量、HNSW、按文档去重），不经过模型，结果确定、一分钟跑完。

    python -m evals.rag.run_rag_eval                  跑一遍，和基线对比
    python -m evals.rag.run_rag_eval --save-baseline  存成基线（evals/baselines/rag.json）

语料（evals/rag/corpus/，先跑 build_corpus）导入单独的 eval_rag schema，跟真实资料库、行为评测的数据都隔开；
内容或分块参数变了才重新算向量。每个标注的答案关键句先校验确实出现在对应文档的某个分块里，标注坏了直接报错。

指标（top_k 跟知行的 search_notes 工具一致，取 5）：
- 文档命中 Recall@k：gold 文档都在前 k 条里（跨文档题要两篇都在）
- 答案命中 Recall@k：除了文档在，返回的 snippet 还要包含答案关键句——知行只看得到 snippet
- MRR：第一篇 gold 文档排在第几，取倒数的平均
- 负例：正例和负例的最高相似度分布、AUC（随机挑一条正例和一条负例，正例分数更高的概率），
  以及按分数阈值拦截负例时，能拦掉多少负例、会误伤多少正例
"""
import os

os.environ["DB_SCHEMA"] = "eval_rag"   # 必须在 import database 之前

import argparse
import asyncio
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import yaml
from sqlalchemy import select, text

from database import Note, NoteChunk, SessionLocal
from evals.fixtures import assert_isolated
from services.notes import chunking
from services.notes import embeddings
from services.notes import notes as notes_service

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.yaml"
CORPUS = ROOT / "corpus"
QUERIES = ROOT / "queries.yaml"
BASELINE = ROOT.parent / "baselines" / "rag.json"
RESULTS = ROOT.parent / "results"
TOP_K = 5


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


def _keys(gold: dict) -> list:
    """答案关键句：可以是一句，也可以是几句备选；没有 key 的 gold（跨文档对比题）只看文档。"""
    key = gold.get("key")
    return [] if key is None else [key] if isinstance(key, str) else list(key)


def _chunker_tag() -> str:
    return f"{embeddings.MODEL_NAME}/{embeddings.DIMENSION}/chunk{chunking.MAX_CHARS}-{chunking.OVERLAP}"


async def load_corpus() -> dict:
    """把语料同步进 eval_rag：内容和分块/向量参数都没变的跳过，变了的删掉重建。返回 文档 id -> 笔记 id。"""
    manifest = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))["docs"]
    wanted = {}
    for d in manifest:
        path = CORPUS / f"{d['id']}.md"
        if not path.exists():
            raise SystemExit(f"缺语料 {path.name}，先跑 python -m evals.rag.build_corpus")
        raw = path.read_text(encoding="utf-8")
        title, _, body = raw.partition("\n")
        wanted[d["id"]] = (title.removeprefix("# ").strip(), body.strip())

    ids, rebuilt = {}, 0
    async with SessionLocal() as db:
        existing = {n.external_id: n for n in (await db.execute(select(Note))).scalars().all()}
        for doc_id, note in existing.items():
            if doc_id not in wanted:
                await db.delete(note)
        await db.commit()
        for doc_id, (title, body) in wanted.items():
            sig = {"sha": hashlib.sha256(body.encode()).hexdigest()[:16], "index": _chunker_tag()}
            note = existing.get(doc_id)
            if note and note.structured_data and json.loads(note.structured_data) == sig:
                ids[doc_id] = note.id
                continue
            if note:
                await db.delete(note)
                await db.commit()
            created = await notes_service.create_note(db, title=title, content=body, category="library",
                                                      source="eval", structured_data=sig)
            row = await db.get(Note, created["id"])
            row.external_id = doc_id
            await db.commit()
            ids[doc_id] = created["id"]
            rebuilt += 1
            print(f"  已导入 {doc_id}", flush=True)
    print(f"语料 {len(ids)} 篇（本次重建 {rebuilt} 篇）")
    return ids


async def validate_labels(queries: list, ids: dict) -> None:
    """每个答案关键句必须完整出现在对应文档的某个分块里，否则这条标注无法命中，评测结果没有意义。"""
    problems = []
    async with SessionLocal() as db:
        for q in queries:
            for g in q.get("gold", []):
                if g["doc"] not in ids:
                    problems.append(f"{q['id']}：没有文档 {g['doc']}")
                    continue
                chunks = (await db.execute(select(NoteChunk.content).where(NoteChunk.note_id == ids[g["doc"]]))).scalars().all()
                for key in _keys(g):
                    if not any(_norm(key) in _norm(c) for c in chunks):
                        problems.append(f"{q['id']}：{g['doc']} 的分块里找不到「{key}」")
    if problems:
        raise SystemExit("标注有问题：\n" + "\n".join(problems))


def _score_query(q: dict, results: list, doc_of: dict) -> dict:
    ranked = [{"doc": doc_of.get(r["id"]), "score": r["score"], "snippet": r["snippet"]} for r in results]
    out = {"group": q["group"], "q": q["q"], "top1_score": ranked[0]["score"] if ranked else 0.0,
           "results": [{"doc": r["doc"], "score": r["score"]} for r in ranked]}
    gold = q.get("gold")
    if not gold:
        return out
    docs = [r["doc"] for r in ranked]
    ranks = [docs.index(g["doc"]) + 1 if g["doc"] in docs else None for g in gold]
    answer_hits = []
    for g in gold:
        if not _keys(g):
            continue
        hit = next((r for r in ranked if r["doc"] == g["doc"]), None)
        answer_hits.append(bool(hit) and any(_norm(k) in _norm(hit["snippet"]) for k in _keys(g)))
    first = min((r for r in ranks if r), default=None)
    out.update({
        "gold_ranks": ranks,
        "doc_hit": {k: all(r and r <= k for r in ranks) for k in (1, 3, 5)},
        "answer_hit": all(answer_hits) if answer_hits else None,   # None：这题只看文档
        "answer_hits": answer_hits,
        "rr": 1 / first if first else 0.0,
    })
    return out


def _summarize(per_query: dict) -> dict:
    pos = [r for r in per_query.values() if "doc_hit" in r]
    neg = [r for r in per_query.values() if "doc_hit" not in r]

    def agg(rows):
        n = len(rows) or 1
        return {
            "n": len(rows),
            "doc_recall@1": round(sum(r["doc_hit"][1] for r in rows) / n, 4),
            "doc_recall@3": round(sum(r["doc_hit"][3] for r in rows) / n, 4),
            "doc_recall@5": round(sum(r["doc_hit"][5] for r in rows) / n, 4),
            "answer_recall@5": (round(sum(r["answer_hit"] for r in answered) / len(answered), 4)
                                if (answered := [r for r in rows if r["answer_hit"] is not None]) else None),
            "mrr": round(sum(r["rr"] for r in rows) / n, 4),
        }

    groups = {}
    for r in pos:
        groups.setdefault(r["group"], []).append(r)
    pos_scores = sorted(r["top1_score"] for r in pos)
    neg_scores = sorted(r["top1_score"] for r in neg)
    auc = (sum((p > n) + 0.5 * (p == n) for p in pos_scores for n in neg_scores) / (len(pos_scores) * len(neg_scores))
           if pos_scores and neg_scores else None)

    # 阈值扫描：最高分低于阈值就当"库里没有"。拦掉的负例越多越好，误伤的正例越少越好
    thresholds = []
    for t in sorted(set(round(s, 2) for s in pos_scores + neg_scores)):
        thresholds.append({"threshold": t,
                           "neg_blocked": round(sum(s < t for s in neg_scores) / (len(neg_scores) or 1), 4),
                           "pos_lost": round(sum(s < t for s in pos_scores) / (len(pos_scores) or 1), 4)})
    safe = [x for x in thresholds if x["pos_lost"] == 0]
    best_safe = max(safe, key=lambda x: x["neg_blocked"]) if safe else None

    def dist(xs):
        return {"min": round(xs[0], 4), "median": round(xs[len(xs) // 2], 4), "max": round(xs[-1], 4)} if xs else None

    return {
        "overall": agg(pos),
        "by_group": {g: agg(rows) for g, rows in groups.items()},
        "negatives": {"n": len(neg), "pos_top1": dist(pos_scores), "neg_top1": dist(neg_scores),
                      "auc": round(auc, 4) if auc is not None else None,
                      "best_zero_loss_threshold": best_safe},
    }


def _pct(x):
    return f"{x * 100:.1f}%"


def _write_report(out_dir: Path, meta: dict, summary: dict, per_query: dict, baseline: dict | None) -> Path:
    b = baseline["summary"] if baseline else None
    lines = ["# 知行检索评测报告", "",
             f"- 时间：{meta['started_at']}　代码版本：{meta['commit']}　索引：{meta['index']}　top_k={TOP_K}",
             f"- 语料 {meta['docs']} 篇（{meta['chunks']} 个分块），题目 {len(per_query)} 条（正例 {summary['overall']['n']}，负例 {summary['negatives']['n']}）", "",
             "## 正例", "",
             "| 分组 | 题数 | 文档@1 | 文档@3 | 文档@5 | 答案@5 | MRR |", "|---|---|---|---|---|---|---|"]

    def row(name, a, ba=None):
        cells = [f"{_pct(a['doc_recall@1'])}", f"{_pct(a['doc_recall@3'])}", f"{_pct(a['doc_recall@5'])}",
                 f"{_pct(a['answer_recall@5'])}" if a["answer_recall@5"] is not None else "-", f"{a['mrr']:.3f}"]
        if ba:
            keys = ["doc_recall@1", "doc_recall@3", "doc_recall@5", "answer_recall@5", "mrr"]
            cells = [c + (f"（{'+' if a[k] - ba[k] >= 0 else ''}{(a[k] - ba[k]) * 100:.1f}）"
                          if a[k] is not None and ba.get(k) is not None and a[k] != ba[k] else "")
                     for c, k in zip(cells, keys)]
        return f"| {name} | {a['n']} | " + " | ".join(cells) + " |"

    lines.append(row("全部", summary["overall"], b["overall"] if b else None))
    for g, a in summary["by_group"].items():
        lines.append(row(g, a, b["by_group"].get(g) if b else None))
    if b:
        lines.append("\n括号里是相对基线的变化（百分点）。")

    n = summary["negatives"]
    lines += ["", "## 负例：分数能不能区分\"库里没有答案\"", "",
              f"- 正例最高分：{n['pos_top1']}", f"- 负例最高分：{n['neg_top1']}",
              f"- AUC：{n['auc']}（1 表示所有正例的最高分都比负例高，0.5 等于随机）"]
    if n["best_zero_loss_threshold"]:
        t = n["best_zero_loss_threshold"]
        lines.append(f"- 不误伤任何正例的最高阈值 {t['threshold']}：能拦掉 {_pct(t['neg_blocked'])} 的负例")

    misses = {k: v for k, v in per_query.items() if v.get("answer_hit") is False or ("doc_hit" in v and not v["doc_hit"][TOP_K])}
    lines += ["", f"## 没命中的正例（{len(misses)} 条）", ""]
    for qid, r in misses.items():
        got = "、".join(f"{x['doc']}({x['score']:.2f})" for x in r["results"])
        why = "文档没检索到" if not all(r["gold_ranks"]) else "文档在但返回的分块不含答案"
        lines.append(f"- {qid}［{r['group']}］{r['q']}")
        lines.append(f"  - {why}；gold 排名 {r['gold_ranks']}；返回：{got}")
    path = out_dir / "report.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--save-baseline", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    await assert_isolated("eval_rag")
    queries = yaml.safe_load(QUERIES.read_text(encoding="utf-8"))["queries"]
    if len({q["id"] for q in queries}) != len(queries):
        raise SystemExit("题目 id 有重复")
    ids = await load_corpus()
    await validate_labels(queries, ids)
    doc_of = {nid: did for did, nid in ids.items()}

    per_query = {}
    async with SessionLocal() as db:
        for q in queries:
            results = await notes_service.search_notes(db, q["q"], top_k=TOP_K)
            per_query[q["id"]] = _score_query(q, results, doc_of)
        chunks = (await db.execute(text("select count(*) from eval_rag.note_chunks"))).scalar()

    summary = _summarize(per_query)
    from evals.run_agent_eval import _git_commit
    meta = {"started_at": datetime.now().strftime("%Y-%m-%d %H:%M"), "commit": _git_commit(),
            "index": _chunker_tag(), "docs": len(ids), "chunks": chunks, "top_k": TOP_K}
    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else None
    out_dir = RESULTS / f"rag-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True)
    payload = {"meta": meta, "summary": summary, "queries": per_query}
    (out_dir / "results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = _write_report(out_dir, meta, summary, per_query, baseline)
    if args.save_baseline:
        BASELINE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已保存基线：{BASELINE}")
    o = summary["overall"]
    print(f"\n文档@5 {_pct(o['doc_recall@5'])}　答案@5 {_pct(o['answer_recall@5'])}　MRR {o['mrr']:.3f}　"
          f"负例 AUC {summary['negatives']['auc']}　报告：{report}")


if __name__ == "__main__":
    asyncio.run(main())
