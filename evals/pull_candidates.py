"""
把线上标成"用例候选"的轮次（以及点踩的轮次）导出成评测用例草稿（第四层：线上问题回流进评测集）。

    python -m evals.pull_candidates            导出还没导出过的候选 + 所有点踩，写到 evals/candidates.yaml
    python -m evals.pull_candidates --mark     导出后把这些候选标成已导出，下次不再重复

只读线上数据（public），除了 --mark 时更新候选的 exported 标记。草稿里带着：
这一轮之前的对话（多轮用例要原样重放）、实际调用了哪些工具和参数、回复开头、用户的反馈和备注。
期望（expect）留空，需要人来写——什么是"对的"只有人能定。写好后挪进 agent_cases.yaml 或留出用例。
草稿含真实对话内容，evals/candidates.yaml 不进 git；收进用例集时可以把隐私内容改写掉。
"""
import os

if os.getenv("DB_SCHEMA"):
    raise SystemExit("这个脚本读线上数据，运行时不要设置 DB_SCHEMA")

import argparse
import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import select, update

from database import AgentTrace, EvalCandidate, Message, MessageFeedback, SessionLocal

OUT = Path(__file__).resolve().parent / "candidates.yaml"
REASONS = {"wrong": "答错了", "fabricated": "编造了内容", "missed_tool": "该用工具没用", "verbose": "啰嗦", "other": "其它"}


def _q(text: str) -> str:
    """YAML 双引号字符串。"""
    return json.dumps(text or "", ensure_ascii=False)


async def _turn_info(db, sid: int, turn: int) -> dict | None:
    msgs = (await db.execute(select(Message).where(Message.session_id == sid).order_by(Message.created_at, Message.id))).scalars().all()
    if turn >= len(msgs) or msgs[turn].role != "user":
        return None
    history = [m.content for m in msgs[:turn + 1] if m.role == "user"]
    reply = msgs[turn + 1].content if turn + 1 < len(msgs) and msgs[turn + 1].role == "assistant" else ""
    steps = (await db.execute(select(AgentTrace).where(
        AgentTrace.session_id == sid, AgentTrace.turn_index == turn, AgentTrace.type == "tool_call").order_by(AgentTrace.id))).scalars().all()
    calls = []
    for s in steps:
        try:
            calls.append((s.name, json.loads(s.payload or "{}").get("args", {})))
        except json.JSONDecodeError:
            calls.append((s.name, {}))
    return {"history": history, "reply": reply, "calls": calls}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mark", action="store_true", help="导出后把候选标成已导出")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    async with SessionLocal() as db:
        cands = (await db.execute(select(EvalCandidate).where(EvalCandidate.exported.is_(False)))).scalars().all()
        downs = (await db.execute(select(MessageFeedback).where(MessageFeedback.rating == "down"))).scalars().all()
        items = {}
        for c in cands:
            items[(c.session_id, c.turn_index)] = {"note": c.note, "candidate_id": c.id}
        for f in downs:
            items.setdefault((f.session_id, f.turn_index), {})["feedback"] = f

        lines = ["# 线上回流的评测用例草稿（python -m evals.pull_candidates 生成，含真实对话，不进 git）",
                 "# 每条补上 expect（参考 agent_cases.yaml 开头的检查项说明），能改写的隐私内容改写掉，再挪进用例集。", "", "cases:"]
        exported, skipped = [], 0
        for (sid, turn), meta in sorted(items.items()):
            info = await _turn_info(db, sid, turn)
            if info is None:
                skipped += 1
                continue
            why = []
            if meta.get("note"):
                why.append(f"备注：{meta['note']}")
            f = meta.get("feedback")
            if f:
                why.append(f"用户点踩：{REASONS.get(f.reason, f.reason or '')}" + (f"，{f.comment}" if f.comment else ""))
            lines += [f"  - id: live_{sid}_{turn}", "    category: 线上回流", f"    why: {_q('；'.join(why) or '线上标记')}"]
            if len(info["history"]) == 1:
                lines.append(f"    say: {_q(info['history'][0])}")
                indent = "    "
            else:
                lines.append("    turns:")
                for say in info["history"][:-1]:
                    lines.append(f"      - say: {_q(say)}")
                lines.append(f"      - say: {_q(info['history'][-1])}")
                indent = "        "
            lines.append(f"{indent}# 实际调用：" + ("、".join(f"{n}({json.dumps(a, ensure_ascii=False)})" for n, a in info["calls"]) or "没有调用工具"))
            lines.append(f"{indent}# 实际回复：{info['reply'][:150].replace(chr(10), ' ')}")
            lines.append(f"{indent}expect: []   # TODO 写期望")
            lines.append("")
            if meta.get("candidate_id"):
                exported.append(meta["candidate_id"])

        OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
        if args.mark and exported:
            await db.execute(update(EvalCandidate).where(EvalCandidate.id.in_(exported)).values(exported=True))
            await db.commit()
    print(f"导出 {len(items) - skipped} 条（候选 {len(cands)}、点踩 {len(downs)}，找不到原对话跳过 {skipped}）→ {OUT}"
          + ("，候选已标成已导出" if args.mark and exported else ""))


if __name__ == "__main__":
    asyncio.run(main())
