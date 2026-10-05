"""
第三层评测：用另一个模型（通义千问）按 rubric.py 的标准给知行的回答打分，并跟人工标注对照校准。

    python -m evals.quality.judge                 给 answers.json 里全部回答打分，出报告
    python -m evals.quality.judge --only-labeled  只给人工标注过的那几条打分（调评分提示词时用，省钱）
    python -m evals.quality.judge --save-baseline 存成基线（evals/baselines/quality.json）
    python -m evals.quality.judge --resume <results.json> --save-baseline   额度中断后只补评失败的条目

环境变量：DASHSCOPE_API_KEY（必需）、DASHSCOPE_BASE_URL（国际站 https://dashscope-intl.aliyuncs.com/compatible-mode/v1，
国内 https://dashscope.aliyuncs.com/compatible-mode/v1，账号也可能是业务空间专属地址，以百炼控制台的示例为准）、
QWEN_JUDGE_MODEL（默认 qwen-max）。每条回答的每个维度单独请求一次，判不通过时要求逐字引用证据并自动核对。
评分用跟知行不同的模型，避免"自己评自己"的偏向；但评分模型本身也会错，所以先用人工标注
（evals/quality/human_labels.json）算一致率和 Cohen's kappa，一致率够高才信它给全部回答打的分。
"""
import argparse
import asyncio
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI

from evals.quality.controls import build_controls
from evals.quality.rubric import DIMENSIONS, dimension_prompt, render_case

load_dotenv()
ROOT = Path(__file__).resolve().parent
ANSWERS = ROOT / "answers.json"
LABELS = ROOT / "human_labels.json"
BASELINE = ROOT.parent / "baselines" / "quality.json"
RESULTS = ROOT.parent / "results"
# 校准结论（2026-10-05，qwen3.8-max-0902，三轮，20 条人工标注 + 18 条人为改坏的对照）：
# 回答到位跟人工一致 95%（kappa 0.64），可以当正式指标；对照组 18/18 全部检出，明显违规（编造、出处错、冒充出处、漏答、来源混淆）抓得住。
# 忠实度 / 来源区分 / 出处在真实回答上跟人工只有 58%–75% 一致，分歧里模型对的错的都有（人漏看过资料里没有的类名，
# 模型也说过"资料只列了三条"而资料里明明五条）——这三项的"不通过"只作为待人工复核的候选，不当正式通过率。
CALIBRATED = {"faithful": False, "separated": False, "cited": False, "complete": True}
CONCURRENCY = 8   # 同时在飞的请求数（每条回答 4 个维度各一次请求）


def _client() -> tuple[AsyncOpenAI, str]:
    key = os.getenv("DASHSCOPE_API_KEY")
    if not key:
        raise SystemExit("没有 DASHSCOPE_API_KEY，先在 .env 里配置")
    base = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
    return AsyncOpenAI(api_key=key, base_url=base), os.getenv("QWEN_JUDGE_MODEL", "qwen-max")


class FatalJudgeError(Exception):
    """评分服务不可用（额度用完、key 无效），整轮评分终止。"""


_STRIP = re.compile(r"[\s*`_#>|\"'“”‘’「」]+")


def _norm(s: str) -> str:
    return _STRIP.sub("", s or "").lower()


def quote_found(quote: str, text: str) -> bool:
    """评分模型给的引用是否真的出现在原文里：去掉空白和 Markdown 符号后比较；引用里有省略号就要求各段按顺序出现。"""
    parts = [_norm(p) for p in re.split(r"……|…|\.\.\.", quote or "") if len(_norm(p)) >= 4]
    if not parts:
        return False
    haystack, pos = _norm(text), 0
    for p in parts:
        i = haystack.find(p, pos)
        if i < 0:
            return False
        pos = i + len(p)
    return True


def apply_evidence_check(out: dict, key: str, reply: str, materials_text: str) -> dict:
    """
    判不通过时核对证据。回答引用必须真的出现在回答里，对不上就作废（记为通过并标出）——防的是评分模型声称回答说过
    其实没说的话（校准时见过：回答已删掉"由 vLLM 提出"，它仍说回答里有）。资料引用对不上只记提醒、不作废：
    资料一侧常常需要转述，或者本来就是"资料里没有"，换 qwen3.8-flash 校准时发现这条规则把两条判对了的对照误作废了。
    """
    out = {k: v for k, v in out.items() if k not in ("invalidated", "material_warning")}
    if out.get("original_verdict"):
        out["verdict"] = out.pop("original_verdict")
    if out["verdict"] != "fail":
        return out
    if out.get("material_quote") and not quote_found(out["material_quote"], materials_text):
        out["material_warning"] = "资料引用在资料里找不到（可能是转述）"
    if key != "complete" and not quote_found(out.get("reply_quote", ""), reply):
        out.update({"verdict": "pass", "invalidated": "回答引用在回答里找不到", "original_verdict": "fail"})
    return out


async def judge_dimension(client: AsyncOpenAI, model: str, item: dict, key: str) -> dict:
    """单独评一个维度。判不通过时核对证据：回答引用必须真在回答里、资料引用必须真在资料里，对不上就作废（记为通过并标出）。"""
    d = DIMENSIONS[key]
    allowed = {"pass", "fail"} | ({"na"} if d["na"] else set())
    materials_text = "\n".join(f"{m['title']}\n{m['content']}" for m in item["materials"])
    last_error = ""
    for attempt in range(3):
        try:
            resp = await client.chat.completions.create(
                model=model, temperature=0, response_format={"type": "json_object"},
                messages=[{"role": "system", "content": dimension_prompt(key)}, {"role": "user", "content": render_case(item)}],
            )
            data = json.loads(resp.choices[0].message.content)
            verdict = data.get("verdict")
            if verdict not in allowed:   # 缺字段或乱填：重试，不再默认当成不通过
                last_error = f"verdict 无效：{verdict!r}"
                continue
            out = {"verdict": verdict, "reason": data.get("reason", ""),
                   "reply_quote": data.get("reply_quote") or "", "material_quote": data.get("material_quote") or ""}
            return apply_evidence_check(out, key, item["reply"], materials_text)
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"[:300]
            # 额度用完、key 无效这类错误重试也没用：直接终止整轮，不要让几百个请求都失败后还生成一份"结果"
            if (getattr(e, "status_code", None) in (401, 403) or "insufficient_quota" in str(e)
                    or "budget limit" in str(e).lower()):
                raise FatalJudgeError(last_error) from e
        await asyncio.sleep(2 * (attempt + 1))
    return {"verdict": None, "error": last_error, "reason": ""}


async def judge_one(client: AsyncOpenAI, model: str, item: dict, sem: asyncio.Semaphore) -> dict:
    async def one(key):
        async with sem:
            return key, await judge_dimension(client, model, item, key)
    results = dict(await asyncio.gather(*(one(k) for k in DIMENSIONS)))
    errors = [f"{k}：{v['error']}" for k, v in results.items() if v.get("error")]
    return {"error": "；".join(errors)} if errors else results


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
    head = "| 范围 | 条数 | " + " | ".join(DIMENSIONS[k]["label"] + ("" if CALIBRATED[k] else "（待复核）") for k in keys) + " |"
    lines = ["# 知行回答质量评测报告", "",
             f"- 时间：{meta['started_at']}　评分模型：{meta['model']}　回答数：{len(answers)}　代码版本：{meta['commit']}",
             "- 通过率只算适用的条目（出处在\"没用任何资料\"时记为不适用）",
             "- 正式指标只有已校准的维度（" + "、".join(DIMENSIONS[k]["label"] for k in keys if CALIBRATED[k]) + "）和对照组检出率；"
             "标\"待复核\"的维度跟人工标注一致率不够，它们的不通过只是候选，需要人看过才算数", ""]
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
    invalid = [(i, k, j[k]) for i, j in judgments.items() if "error" not in j for k in keys if j[k].get("invalidated")]
    if invalid:
        lines += [f"## 作废的判定（评分模型判不通过，但给的引用在原文里找不到）：{len(invalid)} 处", ""]
        lines += [f"- {i}　{DIMENSIONS[k]['label']}：{v['invalidated']}。它的理由：{v['reason']}" for i, k, v in invalid]
        lines.append("")
    lines += ["## 通过率（真实回答）", "", head, "|---|---|" + "---|" * len(keys)]
    for name, r in [("全部", summary["overall"]), ("主题集", summary["main"]), ("留出题", summary["holdout"])] + \
            [(g, r) for g, r in summary["by_group"].items()]:
        lines.append(f"| {name} | {r['n']} | " + " | ".join(_pct(r[k]) for k in keys) + " |")
    lines += ["", "## 不通过的回答", "", "标（待复核）的是未校准维度给出的候选。", ""]
    for a in answers:
        j = judgments.get(a["id"], {})
        if "error" in j:
            lines.append(f"- {a['id']}：评分出错 {j['error']}")
            continue
        bad = [f"{DIMENSIONS[k]['label']}{'' if CALIBRATED[k] else '（待复核）'}：{j[k]['reason']}"
               + (f"　原文：「{j[k]['reply_quote'][:80]}」" if j[k].get("reply_quote") else "")
               for k in keys if j.get(k, {}).get("verdict") == "fail"]
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
    parser.add_argument("--resume", help="接着一份有失败的 results.json：只补评失败的条目，合并后出报告（额度中断后用）")
    parser.add_argument("--rescore", help="不调用模型，按当前的证据核对规则重算一份已有的 results.json（改核对规则后用，不花钱）")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    all_answers = json.loads(ANSWERS.read_text(encoding="utf-8"))
    labels = {x["id"]: x for x in json.loads(LABELS.read_text(encoding="utf-8"))} if LABELS.exists() else {}
    controls = build_controls(all_answers)
    answers = [a for a in all_answers if a["id"] in labels] if args.only_labeled else all_answers
    if args.rescore:
        prev = json.loads(Path(args.rescore).read_text(encoding="utf-8"))
        by_id = {a["id"]: a for a in all_answers + controls}
        judgments = {}
        for i, j in prev["judgments"].items():
            if "error" in j or i not in by_id:
                judgments[i] = j
                continue
            mats = "\n".join(f"{m['title']}\n{m['content']}" for m in by_id[i]["materials"])
            judgments[i] = {k: apply_evidence_check(v, k, by_id[i]["reply"], mats) for k, v in j.items()}
        answers = [a for a in answers if a["id"] in judgments]
        model = prev["meta"]["model"] + "（按新核对规则重算）"
        client = None
    else:
        client, model = _client()
    sem = asyncio.Semaphore(CONCURRENCY)

    async def run(a):
        r = await judge_one(client, model, a, sem)
        print(f"{'✗' if 'error' in r else '✓'} {a['id']}", flush=True)
        return a["id"], r
    if not args.rescore:
        todo = answers + controls
        judgments = {}
        if args.resume:
            prev = json.loads(Path(args.resume).read_text(encoding="utf-8"))
            judgments = {i: j for i, j in prev["judgments"].items() if "error" not in j}
            todo = [a for a in todo if a["id"] not in judgments]
            print(f"接着上次：已有 {len(judgments)} 条，补评 {len(todo)} 条", flush=True)
        try:
            judgments.update(dict(await asyncio.gather(*(run(a) for a in todo))))
        except FatalJudgeError as e:
            raise SystemExit(f"评分服务不可用，已终止，没有生成报告：{e}")

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
    if args.save_baseline and summary["errors"]:
        print(f"有 {summary['errors']} 条评分失败，不保存基线（先解决失败原因再重跑）")
    elif args.save_baseline and not args.only_labeled:
        BASELINE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已保存基线：{BASELINE}")
    o = summary["overall"]
    print(f"\n忠实度 {_pct(o['faithful'])}　出处 {_pct(o['cited'])}　回答到位 {_pct(o['complete'])}"
          + (f"　校准一致率：" + "、".join(f"{DIMENSIONS[k]['label']} {_pct(cal[k]['agreement'])}" for k in DIMENSIONS) if cal else "")
          + f"　对照组检出率 {_pct(ctrl['overall'])}"
          + f"　报告：{report}")


if __name__ == "__main__":
    asyncio.run(main())
