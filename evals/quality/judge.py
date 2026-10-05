"""
第三层评测：用另一个模型（通义千问）按 rubric.py 的标准给知行的回答打分，并跟人工标注对照校准。

    python -m evals.quality.judge                 给 answers.json 里全部回答打分，出报告
    python -m evals.quality.judge --only-labeled  只给人工标注过的那几条打分（调评分提示词时用，省钱）
    python -m evals.quality.judge --save-baseline 存成基线（evals/baselines/quality.json）

环境变量：DASHSCOPE_API_KEY（必需）、DASHSCOPE_BASE_URL（国际站 https://dashscope-intl.aliyuncs.com/compatible-mode/v1，
国内 https://dashscope.aliyuncs.com/compatible-mode/v1）、QWEN_JUDGE_MODEL（默认 qwen-max）。
评分用跟知行不同的模型，避免"自己评自己"的偏向；但评分模型本身也会错，所以先用人工标注
（evals/quality/human_labels.json）算一致率和 Cohen's kappa，一致率够高才信它给全部回答打的分。
"""
import argparse
import asyncio
import json
import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI

from evals.quality.controls import build_controls
from evals.quality.rubric import DIMENSIONS, SYSTEM_PROMPT, render_case

load_dotenv()
ROOT = Path(__file__).resolve().parent
ANSWERS = ROOT / "answers.json"
LABELS = ROOT / "human_labels.json"
BASELINE = ROOT.parent / "baselines" / "quality.json"
RESULTS = ROOT.parent / "results"
CONCURRENCY = 4


def _client() -> tuple[AsyncOpenAI, str]:
    key = os.getenv("DASHSCOPE_API_KEY")
    if not key:
        raise SystemExit("没有 DASHSCOPE_API_KEY，先在 .env 里配置")
    base = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
    return AsyncOpenAI(api_key=key, base_url=base), os.getenv("QWEN_JUDGE_MODEL", "qwen-max")


async def judge_one(client: AsyncOpenAI, model: str, item: dict) -> dict:
    for attempt in range(3):
        try:
            resp = await client.chat.completions.create(
                model=model, temperature=0, response_format={"type": "json_object"},
                messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": render_case(item)}],
            )
            data = json.loads(resp.choices[0].message.content)
            out = {}
            for key, d in DIMENSIONS.items():
                v = (data.get(key) or {}).get("verdict")
                allowed = {"pass", "fail"} | ({"na"} if d["na"] else set())
                out[key] = {"verdict": v if v in allowed else "fail", "reason": (data.get(key) or {}).get("reason", "")}
            return out
        except Exception as e:
            if attempt == 2:
                return {"error": f"{type(e).__name__}: {e}"[:300]}
            await asyncio.sleep(2 * (attempt + 1))


def kappa(pairs: list[tuple[str, str]]) -> float | None:
    """Cohen's kappa：扣掉"碰巧一致"之后的一致程度。1 完全一致，0 跟随机一样。"""
    if not pairs:
        return None
    n = len(pairs)
    po = sum(a == b for a, b in pairs) / n
    ca, cb = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    # 人和模型都只出现一种判定时（比如全是通过）期望一致率就是 1，kappa 无法计算，返回 None 而不是假装完全一致
    return round((po - pe) / (1 - pe), 3) if pe < 1 else None


def _ok(v: str) -> str:
    """一致率按"有没有问题"比：出处的"不适用"（没用资料，不需要出处）和"通过"都算没问题。"""
    return "fail" if v == "fail" else "ok"


def calibrate(judgments: dict, labels: dict) -> dict:
    """跟人工标注对照：一致率、kappa，以及人判没问题、模型却判不通过的误报率。"""
    out = {}
    for key in DIMENSIONS:
        rows = [(i, _ok(labels[i][key]), _ok(judgments[i][key]["verdict"])) for i in labels
                if i in judgments and "error" not in judgments[i] and labels[i].get(key)]
        human_ok = [r for r in rows if r[1] == "ok"]
        out[key] = {
            "n": len(rows),
            "agreement": round(sum(h == j for _, h, j in rows) / len(rows), 3) if rows else None,
            "kappa": kappa([(h, j) for _, h, j in rows]),
            "false_alarm": round(sum(j == "fail" for _, _, j in human_ok) / len(human_ok), 3) if human_ok else None,
            "disagreements": [{"id": i, "human": labels[i][key], "judge": judgments[i][key]["verdict"],
                               "judge_reason": judgments[i][key]["reason"], "human_note": labels[i].get("note")}
                              for i, h, j in rows if h != j],
        }
    return out


def control_detection(controls: list, judgments: dict) -> dict:
    """对照组：每条按构造在 target 维度上就该不通过，统计评分模型判出 fail 的比例。"""
    by_type = {}
    for c in controls:
        j = judgments.get(c["id"], {})
        hit = "error" not in j and j.get(c["target"], {}).get("verdict") == "fail"
        by_type.setdefault(c["control_type"], []).append({
            "id": c["id"], "target": c["target"], "detected": hit,
            "reason": j.get(c["target"], {}).get("reason", j.get("error", ""))})
    total = [x for xs in by_type.values() for x in xs]
    return {"overall": round(sum(x["detected"] for x in total) / len(total), 3) if total else None,
            "by_type": {t: {"n": len(xs), "detected": round(sum(x["detected"] for x in xs) / len(xs), 3), "items": xs}
                        for t, xs in by_type.items()}}


def summarize(answers: list, judgments: dict) -> dict:
    def rates(items):
        res = {}
        for key, d in DIMENSIONS.items():
            vs = [judgments[a["id"]][key]["verdict"] for a in items if a["id"] in judgments and "error" not in judgments[a["id"]]]
            applicable = [v for v in vs if v != "na"]
            res[key] = round(sum(v == "pass" for v in applicable) / len(applicable), 4) if applicable else None
        return {"n": len(items), **res}
    groups = {}
    for a in answers:
        groups.setdefault(a["group"], []).append(a)
    return {"overall": rates(answers), "main": rates([a for a in answers if a["set"] == "main"]),
            "holdout": rates([a for a in answers if a["set"] == "holdout"]),
            "by_group": {g: rates(items) for g, items in groups.items()},
            "errors": sum(1 for j in judgments.values() if "error" in j)}


def _pct(x):
    return "-" if x is None else f"{x * 100:.1f}%"


def write_report(out_dir: Path, meta: dict, summary: dict, cal: dict | None, answers: list, judgments: dict,
                 ctrl: dict | None = None) -> Path:
    keys = list(DIMENSIONS)
    head = "| 范围 | 条数 | " + " | ".join(DIMENSIONS[k]["label"] for k in keys) + " |"
    lines = ["# 知行回答质量评测报告", "",
             f"- 时间：{meta['started_at']}　评分模型：{meta['model']}　回答数：{len(answers)}　代码版本：{meta['commit']}",
             "- 通过率只算适用的条目（出处在\"没用任何资料\"时记为不适用）", ""]
    if cal:
        lines += ["## 跟人工标注对照（校准）", "", "| 维度 | 对照条数 | 一致率 | Cohen's kappa | 误报率 |", "|---|---|---|---|---|"]
        for k in keys:
            c = cal[k]
            lines.append(f"| {DIMENSIONS[k]['label']} | {c['n']} | {_pct(c['agreement'])} | {c['kappa']} | {_pct(c['false_alarm'])} |")
        lines += ["", "误报率：人判没问题、模型判不通过的比例。人工标注里几乎没有不通过的样本，kappa 参考意义有限，"
                      "能不能抓出问题看下面的对照组。", ""]
        for k in keys:
            for dis in cal[k]["disagreements"]:
                lines.append(f"- {DIMENSIONS[k]['label']}　{dis['id']}：人判 {dis['human']}，模型判 {dis['judge']}。模型理由：{dis['judge_reason']}"
                             + (f"；人的备注：{dis['human_note']}" if dis.get("human_note") else ""))
        lines.append("")
    if ctrl:
        lines += ["## 对照组：人为改坏的回答能不能被抓出来", "", f"总检出率 {_pct(ctrl['overall'])}", "",
                  "| 改动类型 | 条数 | 检出率 |", "|---|---|---|"]
        for t, v in ctrl["by_type"].items():
            lines.append(f"| {t} | {v['n']} | {_pct(v['detected'])} |")
        lines.append("")
        for t, v in ctrl["by_type"].items():
            for x in v["items"]:
                if not x["detected"]:
                    lines.append(f"- 漏检　{x['id']}（{t}，应判{DIMENSIONS[x['target']]['label']}不通过）：模型理由：{x['reason']}")
        lines.append("")
    lines += ["## 通过率（真实回答）", "", head, "|---|---|" + "---|" * len(keys)]
    for name, r in [("全部", summary["overall"]), ("主题集", summary["main"]), ("留出题", summary["holdout"])] + \
            [(g, r) for g, r in summary["by_group"].items()]:
        lines.append(f"| {name} | {r['n']} | " + " | ".join(_pct(r[k]) for k in keys) + " |")
    lines += ["", "## 不通过的回答", ""]
    for a in answers:
        j = judgments.get(a["id"], {})
        if "error" in j:
            lines.append(f"- {a['id']}：评分出错 {j['error']}")
            continue
        bad = [f"{DIMENSIONS[k]['label']}：{j[k]['reason']}" for k in keys if j.get(k, {}).get("verdict") == "fail"]
        if bad:
            lines.append(f"- {a['id']}［{a['group']}］{a['question']}")
            lines += [f"  - {b}" for b in bad]
    path = out_dir / "report.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only-labeled", action="store_true")
    parser.add_argument("--save-baseline", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    all_answers = json.loads(ANSWERS.read_text(encoding="utf-8"))
    labels = {x["id"]: x for x in json.loads(LABELS.read_text(encoding="utf-8"))} if LABELS.exists() else {}
    controls = build_controls(all_answers)
    answers = [a for a in all_answers if a["id"] in labels] if args.only_labeled else all_answers
    client, model = _client()
    sem = asyncio.Semaphore(CONCURRENCY)

    async def run(a):
        async with sem:
            r = await judge_one(client, model, a)
            print(f"{'✗' if 'error' in r else '✓'} {a['id']}", flush=True)
            return a["id"], r
    judgments = dict(await asyncio.gather(*(run(a) for a in answers + controls)))

    from evals.run_agent_eval import _git_commit
    meta = {"started_at": datetime.now().strftime("%Y-%m-%d %H:%M"), "model": model, "commit": _git_commit()}
    summary = summarize(answers, judgments)
    cal = calibrate(judgments, labels) if labels else None
    ctrl = control_detection(controls, judgments)
    out_dir = RESULTS / f"quality-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True)
    payload = {"meta": meta, "summary": summary, "calibration": cal, "controls": ctrl, "judgments": judgments}
    (out_dir / "results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = write_report(out_dir, meta, summary, cal, answers, judgments, ctrl)
    if args.save_baseline and not args.only_labeled:
        BASELINE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已保存基线：{BASELINE}")
    o = summary["overall"]
    print(f"\n忠实度 {_pct(o['faithful'])}　出处 {_pct(o['cited'])}　回答到位 {_pct(o['complete'])}"
          + (f"　校准一致率：" + "、".join(f"{DIMENSIONS[k]['label']} {_pct(cal[k]['agreement'])}" for k in DIMENSIONS) if cal else "")
          + f"　对照组检出率 {_pct(ctrl['overall'])}"
          + f"　报告：{report}")


if __name__ == "__main__":
    asyncio.run(main())
