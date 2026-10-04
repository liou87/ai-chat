"""
知行 Agent 行为评测运行器。

    python -m evals.run_agent_eval                      跑全部用例，每条 3 次
    python -m evals.run_agent_eval --only id1,id2       只跑指定用例
    python -m evals.run_agent_eval --category 核心记忆   只跑某一类
    python -m evals.run_agent_eval --save-baseline      跑完把结果存成基线（evals/baselines/agent.json）

每条用例开始前把 eval schema 的数据恢复成同一个初始状态（evals/fixtures.py），时间固定在 2026-10-06 10:00，
联网类工具换成固定返回（evals/mocks.py），其余工具和真实线上一样执行。模型输出有随机性，所以每条跑多次，
报告里同时给出单次通过率（pass@1，所有次数的平均）和"每次都过"的比例（pass^k，衡量稳定性）。
结果写到 evals/results/<时间>/，有基线时逐条对比，列出变好和变差的用例。
"""
import os

os.environ["DB_SCHEMA"] = "eval"   # 必须在 import database 之前：所有读写都落在 eval schema

import argparse
import asyncio
import json
import logging
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import yaml
from sqlalchemy import select

from database import AgentTrace, ChatSession, Message, SessionLocal
from evals import fixtures, mocks
from evals.assertions import check_turn
from routers.chat import ChatRequest, MessageSchema, _build_messages
from services import memory as memory_service
from services.agent import run_agent
from services.llm import MODEL_NAME

ROOT = Path(__file__).resolve().parent
CASES_FILE = ROOT / "agent_cases.yaml"
BASELINE_FILE = ROOT / "baselines" / "agent.json"
RESULTS_DIR = ROOT / "results"


def _git_commit() -> str:
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=ROOT).stdout.strip()
        return sha + ("+改动未提交" if dirty else "")
    except OSError:
        return "unknown"


def _turns(case: dict) -> list[dict]:
    return case["turns"] if "turns" in case else [{"say": case["say"], "expect": case.get("expect")}]


async def _turn_metrics(session_id: int, turn_index: int) -> dict:
    async with SessionLocal() as db:
        rows = (await db.execute(select(AgentTrace).where(
            AgentTrace.session_id == session_id, AgentTrace.turn_index == turn_index, AgentTrace.type == "llm",
        ))).scalars().all()
    return {
        "llm_calls": len(rows),
        "prompt_tokens": sum(r.prompt_tokens or 0 for r in rows),
        "completion_tokens": sum(r.completion_tokens or 0 for r in rows),
    }


def _override_tools(results: dict | None) -> dict:
    """用例里的 tool_results：这一条用例期间，指定工具直接返回给定结果（比如模拟报错）。返回原来的处理函数，跑完还原。"""
    from services.tools import TOOL_HANDLERS
    saved = {}
    for name, result in (results or {}).items():
        saved[name] = TOOL_HANDLERS[name]

        async def fixed(db, args, _result=result):
            return _result
        TOOL_HANDLERS[name] = fixed
    return saved


async def run_trial(case: dict) -> dict:
    """跑一次：恢复初始数据，按顺序发每一轮，检查有 expect 的轮次。"""
    from services.tools import TOOL_HANDLERS
    await fixtures.reset_state()
    await fixtures.apply_setup(case.get("setup"))
    refs = await fixtures.resolve_refs()
    saved = _override_tools(case.get("tool_results"))
    try:
        return await _run_turns(case, refs)
    finally:
        TOOL_HANDLERS.update(saved)


async def _run_turns(case: dict, refs: dict) -> dict:
    async with SessionLocal() as db:
        session = ChatSession(title=f"[eval] {case['id']}")
        db.add(session)
        await db.commit()
        session_id = session.id

        history, turns_out, passed = [], [], True
        for turn_index_in_case, turn in enumerate(_turns(case)):
            history.append({"role": "user", "content": turn["say"]})
            turn_index = turn_index_in_case * 2   # 跟线上一样：轮次号 = 这轮之前的消息条数
            db.add(Message(session_id=session_id, role="user", content=turn["say"]))
            await db.commit()

            request = ChatRequest(session_id=session_id, messages=[MessageSchema(**m) for m in history])
            start = time.monotonic()
            reply, trace = await run_agent(db, session_id, turn_index, await _build_messages(db, request))
            latency_ms = int((time.monotonic() - start) * 1000)

            db.add(Message(session_id=session_id, role="assistant", content=reply))
            await db.commit()
            await memory_service.remember_turn(db, session_id, turn["say"], reply)
            history.append({"role": "assistant", "content": reply})

            calls = [{"name": t["name"], "args": t["args"]} for t in trace if t["type"] == "tool_call"]
            metrics = await _turn_metrics(session_id, turn_index)
            checks = await check_turn(turn.get("expect"), calls, reply, refs, metrics)
            turn_ok = all(ok for ok, _ in checks)
            passed = passed and turn_ok
            turns_out.append({
                "say": turn["say"], "reply": reply, "tools": calls, "latency_ms": latency_ms,
                "checks": [{"ok": ok, "detail": why} for ok, why in checks],
                "truncated": any(t.get("truncated") for t in trace if t["type"] == "final"),
                **metrics,
            })
    return {"passed": passed, "turns": turns_out}


def _summarize(results: dict, trials: int) -> dict:
    cases = list(results.values())
    all_trials = [t for c in cases for t in c["trials"]]
    turns = [turn for t in all_trials if "turns" in t for turn in t["turns"]]
    by_cat = {}
    for c in cases:
        by_cat.setdefault(c["category"], []).append(c)

    def rate(cs):
        return round(sum(c["pass_rate"] for c in cs) / len(cs), 4) if cs else 0

    def avg(key):
        return round(sum(t[key] for t in turns) / len(turns), 1) if turns else 0

    return {
        "cases": len(cases),
        "trials_per_case": trials,
        "pass_at_1": rate(cases),
        "pass_all_k": round(sum(1 for c in cases if c["pass_rate"] == 1) / len(cases), 4) if cases else 0,
        "errors": sum(1 for t in all_trials if "error" in t),
        "avg_prompt_tokens_per_turn": avg("prompt_tokens"),
        "avg_completion_tokens_per_turn": avg("completion_tokens"),
        "avg_llm_calls_per_turn": avg("llm_calls"),
        "avg_latency_ms_per_turn": avg("latency_ms"),
        "by_category": {cat: {"cases": len(cs), "pass_at_1": rate(cs)} for cat, cs in by_cat.items()},
    }


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def _write_report(out_dir: Path, meta: dict, summary: dict, results: dict, baseline: dict | None) -> Path:
    s = summary
    lines = [
        "# 知行 Agent 行为评测报告", "",
        f"- 时间：{meta['started_at']}　模型：{meta['model']}　代码版本：{meta['commit']}",
        f"- 用例 {s['cases']} 条，每条 {s['trials_per_case']} 次；评测时间固定为 {meta['frozen_now']}；"
        f"替换成固定返回的外部工具：{'、'.join(meta['mocked_tools'])}", "",
        "## 总览", "",
        "| 指标 | 本次 |" + (" 基线 | 变化 |" if baseline else ""),
        "|---|---|" + ("---|---|" if baseline else ""),
    ]
    b = baseline["summary"] if baseline else None
    rows = [
        ("单次通过率 pass@1", "pass_at_1", _pct, True),
        (f"每次都过 pass^{s['trials_per_case']}", "pass_all_k", _pct, True),
        ("每轮平均输入 token", "avg_prompt_tokens_per_turn", lambda v: f"{v:,.0f}", False),
        ("每轮平均输出 token", "avg_completion_tokens_per_turn", lambda v: f"{v:,.0f}", False),
        ("每轮平均模型调用次数", "avg_llm_calls_per_turn", lambda v: f"{v:.2f}", False),
        ("每轮平均耗时", "avg_latency_ms_per_turn", lambda v: f"{v / 1000:.1f}s", False),
        ("运行出错次数", "errors", str, False),
    ]
    for label, key, fmt, is_rate in rows:
        line = f"| {label} | {fmt(s[key])} |"
        if b and key in b:
            diff = s[key] - b[key]
            line += f" {fmt(b[key])} | {'+' if diff >= 0 else ''}{(_pct(diff) if is_rate else fmt(diff))} |"
        lines.append(line)

    lines += ["", "## 分类", "", "| 类别 | 用例数 | pass@1 |" + (" 基线 |" if b else ""), "|---|---|---|" + ("---|" if b else "")]
    for cat, v in s["by_category"].items():
        line = f"| {cat} | {v['cases']} | {_pct(v['pass_at_1'])} |"
        if b:
            bc = b["by_category"].get(cat)
            line += f" {_pct(bc['pass_at_1']) if bc else '-'} |"
        lines.append(line)

    if baseline:
        changed = []
        for cid, c in results.items():
            bc = baseline["cases"].get(cid)
            if bc and abs(c["pass_rate"] - bc["pass_rate"]) >= 1e-9:
                changed.append((c["pass_rate"] - bc["pass_rate"], cid, bc["pass_rate"], c["pass_rate"]))
        lines += ["", "## 和基线相比有变化的用例", ""]
        if changed:
            for diff, cid, old, new in sorted(changed):
                lines.append(f"- {'变差' if diff < 0 else '变好'}　{cid}：{_pct(old)} → {_pct(new)}")
        else:
            lines.append("没有。")

    failing = {cid: c for cid, c in results.items() if c["pass_rate"] < 1}
    lines += ["", f"## 没有全过的用例（{len(failing)} 条）", ""]
    for cid, c in failing.items():
        lines.append(f"### {cid}　{c['category']}　通过 {_pct(c['pass_rate'])}")
        if c.get("why"):
            lines.append(f"用例意图：{c['why']}")
        for i, t in enumerate(c["trials"], 1):
            if "error" in t:
                lines.append(f"- 第 {i} 次：运行出错 {t['error']}")
                continue
            if t["passed"]:
                lines.append(f"- 第 {i} 次：通过")
                continue
            for turn in t["turns"]:
                bad = [ch["detail"] for ch in turn["checks"] if not ch["ok"]]
                if not bad:
                    continue
                tools = "、".join(f"{x['name']}({json.dumps(x['args'], ensure_ascii=False)})" for x in turn["tools"]) or "无"
                reply = turn["reply"].replace("\n", " ")
                lines.append(f"- 第 {i} 次，「{turn['say'][:30]}」：{'；'.join(bad)}")
                lines.append(f"  - 调用：{tools[:300]}")
                lines.append(f"  - 回复：{reply[:200]}")
        lines.append("")

    path = out_dir / "report.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


async def main():
    parser = argparse.ArgumentParser(description="知行 Agent 行为评测")
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--only", help="逗号分隔的用例 id")
    parser.add_argument("--category")
    parser.add_argument("--save-baseline", action="store_true")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.WARNING)

    cases = yaml.safe_load(CASES_FILE.read_text(encoding="utf-8"))["cases"]
    ids = [c["id"] for c in cases]
    if len(ids) != len(set(ids)):
        raise SystemExit("用例 id 有重复")
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    if args.category:
        cases = [c for c in cases if c["category"] == args.category]
    if not cases:
        raise SystemExit("没有匹配的用例")

    await fixtures.assert_isolated()
    fixtures.freeze_clock()
    mocks.install()
    await fixtures.seed_static()

    meta = {
        "started_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "model": MODEL_NAME, "commit": _git_commit(),
        "frozen_now": fixtures.FROZEN_NOW.strftime("%Y-%m-%d %H:%M"), "mocked_tools": list(mocks.MOCKED_TOOLS),
    }
    results = {}
    total = len(cases) * args.trials
    done = 0
    for case in cases:
        trials = []
        for _ in range(args.trials):
            try:
                trials.append(await run_trial(case))
            except Exception as e:   # 模型接口超时之类：记成这次失败，不中断整轮评测
                logging.exception(f"{case['id']} 运行出错")
                trials.append({"passed": False, "error": f"{type(e).__name__}: {e}"[:300]})
            done += 1
            mark = "✓" if trials[-1]["passed"] else "✗"
            print(f"[{done}/{total}] {mark} {case['id']}", flush=True)
        results[case["id"]] = {
            "category": case["category"], "why": case.get("why"),
            "pass_rate": round(sum(t["passed"] for t in trials) / len(trials), 4), "trials": trials,
        }

    summary = _summarize(results, args.trials)
    baseline = json.loads(BASELINE_FILE.read_text(encoding="utf-8")) if BASELINE_FILE.exists() else None
    out_dir = RESULTS_DIR / datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir.mkdir(parents=True)
    payload = {"meta": meta, "summary": summary, "cases": results}
    (out_dir / "results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = _write_report(out_dir, meta, summary, results, baseline)

    if args.save_baseline:
        if (args.only or args.category) and baseline:
            # 只跑了部分用例（比如改了这几条的断言）：把它们替换进现有基线，其余用例保持原样，总览重新算
            merged = {**baseline["cases"], **results}
            merged = {cid: merged[cid] for cid in [c["id"] for c in yaml.safe_load(CASES_FILE.read_text(encoding="utf-8"))["cases"]] if cid in merged}
            payload = {"meta": {**meta, "merged_cases": sorted(results)}, "summary": _summarize(merged, args.trials), "cases": merged}
        BASELINE_FILE.parent.mkdir(exist_ok=True)
        BASELINE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已保存基线：{BASELINE_FILE}" + (f"（替换了 {len(results)} 条用例）" if args.only or args.category else ""))

    print(f"\npass@1 {_pct(summary['pass_at_1'])}　pass^{args.trials} {_pct(summary['pass_all_k'])}　"
          f"每轮输入 {summary['avg_prompt_tokens_per_turn']:,.0f} token　报告：{report}")


if __name__ == "__main__":
    asyncio.run(main())
