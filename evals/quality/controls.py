"""
按 perturbations.yaml 把真实的好回答改坏，生成评分模型的对照组（每条只改一处，正确答案按构造是"不通过"）。
judge.py 会把它们跟真实回答一起打分，算每类改动的检出率。
"""
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
SPEC = ROOT / "perturbations.yaml"


def build_controls(answers: list) -> list:
    by_id = {a["id"]: a for a in answers}
    out = []
    for c in yaml.safe_load(SPEC.read_text(encoding="utf-8"))["controls"]:
        base = by_id[c["base"]]
        reply = base["reply"]
        if "edit" in c:
            old = c["edit"]["old"]
            if reply.count(old) != 1:
                raise SystemExit(f"{c['id']}：要替换的原文在 {c['base']} 里出现了 {reply.count(old)} 次，必须正好 1 次")
            reply = reply.replace(old, c["edit"]["new"])
        elif "truncate_from" in c:
            i = reply.find(c["truncate_from"])
            if i < 0:
                raise SystemExit(f"{c['id']}：{c['base']} 里找不到「{c['truncate_from']}」")
            reply = reply[:i].rstrip()
        elif "delete_between" in c:
            start, end = c["delete_between"]
            i, j = reply.find(start), reply.find(end)
            if i < 0 or j <= i:
                raise SystemExit(f"{c['id']}：{c['base']} 里找不到要删的区间")
            reply = reply[:i] + reply[j:]
        out.append({**base, "id": c["id"], "set": "control", "base": c["base"], "control_type": c["type"],
                    "target": c["target"], "reply": reply})
    return out


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    answers = json.loads((ROOT / "answers.json").read_text(encoding="utf-8"))
    for c in build_controls(answers):
        base = next(a for a in answers if a["id"] == c["base"])
        print(f"{c['id']:32} {c['control_type']}  {len(base['reply'])} → {len(c['reply'])} 字")
