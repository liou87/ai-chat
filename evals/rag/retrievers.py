"""
检索方案对比实验：线上方案（baseline）之外的几种做法，只在评测里跑，不改线上代码和数据库。

- baseline：线上 search_notes 原样调用（HNSW 近似检索；2026-10-05 起线上每篇给 2 个分块）。
- exact：线上原来的逻辑（每篇 1 个分块），只是用精确余弦代替 HNSW。下面几个方案都基于精确计算，跟它比才是只差一个因素的对照。
- more_candidates：候选分块从 top_k×4 提高到 top_k×10，看长文档挤占结果的问题能缓解多少。
- two_chunks（方案 A）：候选池不变，每篇文档给模型前 2 个分块而不是 1 个。
- hybrid（方案 B）：向量检索和 BM25 关键词检索各取前 50 个分块，用 RRF（k=60）融合排序，再按文档去重取 1 个分块。
- hybrid_two_chunks（方案 C）：B 加 A。
- hybrid_terms / hybrid_terms_two_chunks：第一轮对比发现整句做 BM25 在"中文提问、英文资料"时帮倒忙
  （中文常用词把无关的中文文章顶上来，英文 README 又匹配不到），于是只拿问题里的英文术语、参数名、数字
  （halfvec、efConstruction、LoCoMo 这类）去做 BM25，问题里没有这类词就只用向量。这是看过主题集结果后设计的，
  结论要以留出题（queries_holdout.yaml）为准。

BM25 在 Python 里算：jieba 切中文、英文按词小写，对"标题+分块"建索引（跟算向量时的输入一致）。
这是离线验证用的，证明值得做之后，线上再决定用 Postgres 全文检索（jieba 切词存 tsvector）还是 pg_trgm。

每个方案返回同样的结构：[{note_id, score, snippets: [分块...]}]，score 统一用这篇文档最高的余弦相似度，
负例分析在各方案之间可比。
"""
import re

import jieba
import numpy as np
from rank_bm25 import BM25Okapi
from sqlalchemy import select

from database import Note, NoteChunk
from services.notes.embeddings import embed_text

jieba.setLogLevel(60)   # 关掉加载词典时的日志

RRF_K = 60
POOL = 50


def tokenize(text: str) -> list[str]:
    return [t for t in (w.strip().lower() for w in jieba.lcut(text or "")) if t and re.search(r"\w", t)]


def term_tokens(query: str) -> list[str]:
    """问题里的英文术语、参数名、数字：至少两个字符的 ASCII 词（含下划线、点、连字符）。"""
    terms = re.findall(r"[A-Za-z0-9][A-Za-z0-9_.\-]*[A-Za-z0-9]", query or "")
    return [t for t in (w.lower() for w in terms) if len(t) >= 2]


class Index:
    """评测语料的分块、向量和 BM25 索引，整个实验只建一次。"""

    def __init__(self, rows: list):
        self.chunks = rows   # [(chunk_id, note_id, title, content, embedding)]
        m = np.array([r[4] for r in rows], dtype=np.float32)
        self.matrix = m / np.linalg.norm(m, axis=1, keepdims=True)
        self.bm25 = BM25Okapi([tokenize(f"{title}\n{content}") for _, _, title, content, _ in rows])

    @classmethod
    async def build(cls, db) -> "Index":
        rows = (await db.execute(
            select(NoteChunk.id, NoteChunk.note_id, Note.title, NoteChunk.content, NoteChunk.embedding)
            .join(Note, Note.id == NoteChunk.note_id).order_by(NoteChunk.id)
        )).all()
        return cls([(r[0], r[1], r[2], r[3], list(r[4])) for r in rows])


def _cosine_ranked(index: Index, qvec: list) -> list[tuple[int, float]]:
    """全量精确余弦（语料只有一千多个分块），返回 [(分块下标, 相似度)] 从高到低。"""
    q = np.array(qvec, dtype=np.float32)
    sims = index.matrix @ (q / np.linalg.norm(q))
    order = np.argsort(-sims)
    return [(int(i), float(sims[i])) for i in order]


def _group(index: Index, order: list[int], best_cos: dict, top_k: int, per_note: int) -> list[dict]:
    """按融合后的分块顺序归到文档：文档按它第一个分块出现的位置排序，每篇最多带 per_note 个分块。"""
    notes, out = {}, []
    for i in order:
        note_id = index.chunks[i][1]
        if note_id not in notes:
            if len(notes) == top_k:
                continue
            notes[note_id] = []
        if len(notes[note_id]) < per_note:
            notes[note_id].append(index.chunks[i][3])
    for note_id, snippets in notes.items():
        out.append({"note_id": note_id, "score": best_cos[note_id], "snippets": snippets})
    return out


async def retrieve(variant: str, index: Index, db, query: str, top_k: int = 5) -> list[dict]:
    if variant == "baseline":
        from services.notes import notes as notes_service
        results = await notes_service.search_notes(db, query, top_k=top_k)
        return [{"note_id": r["id"], "score": r["score"], "snippets": r["snippets"]} for r in results]

    qvec = await embed_text(query)
    cos = _cosine_ranked(index, qvec)
    best_cos = {}
    for i, s in cos:
        best_cos.setdefault(index.chunks[i][1], round(s, 4))

    if variant in ("exact", "more_candidates", "two_chunks"):
        pool = top_k * (10 if variant == "more_candidates" else 4)
        order = [i for i, _ in cos[:pool]]
        return _group(index, order, best_cos, top_k, per_note=2 if variant == "two_chunks" else 1)

    if variant in ("hybrid", "hybrid_two_chunks", "hybrid_terms", "hybrid_terms_two_chunks"):
        vec_rank = [i for i, _ in cos[:POOL]]
        q_tokens = term_tokens(query) if variant.startswith("hybrid_terms") else tokenize(query)
        bm = index.bm25.get_scores(q_tokens) if q_tokens else [0] * len(index.chunks)
        bm_rank = [i for i in sorted(range(len(bm)), key=lambda i: -bm[i])[:POOL] if bm[i] > 0]
        fused = {}
        for ranking in (vec_rank, bm_rank):
            for r, i in enumerate(ranking):
                fused[i] = fused.get(i, 0) + 1 / (RRF_K + r + 1)
        order = sorted(fused, key=lambda i: -fused[i])
        return _group(index, order, best_cos, top_k, per_note=2 if variant.endswith("two_chunks") else 1)

    raise ValueError(f"不认识的方案：{variant}")


VARIANTS = ["baseline", "exact", "more_candidates", "two_chunks", "hybrid", "hybrid_two_chunks",
            "hybrid_terms", "hybrid_terms_two_chunks"]
