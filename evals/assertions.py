"""
用例里 expect 检查项的实现。每个检查返回 (是否通过, 说明)，说明会写进报告，方便看是哪里没过。
全部是代码断言，不用模型打分：结果确定、可复现、不花钱。
"""
import re
from datetime import datetime
from sqlalchemy import select
from database import Base, SessionLocal
from services import clock


def _parse_dt(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return clock.to_local(dt)


def _match_arg(actual, spec, refs: dict) -> tuple[bool, str]:
    if isinstance(spec, dict):
        if "contains" in spec:
            ok = isinstance(actual, str) and spec["contains"].lower() in actual.lower()
            return ok, f"应包含「{spec['contains']}」，实际 {actual!r}"
        if "contains_any" in spec:
            ok = isinstance(actual, str) and any(w.lower() in actual.lower() for w in spec["contains_any"])
            return ok, f"应包含 {spec['contains_any']} 之一，实际 {actual!r}"
        if "in" in spec:
            return actual in spec["in"], f"应为 {spec['in']} 之一，实际 {actual!r}"
        if "ref" in spec:
            expected = refs.get(spec["ref"])
            return actual == expected, f"应为 {spec['ref']}（id={expected}），实际 {actual!r}"
        if "datetime" in spec:
            dt = _parse_dt(actual)
            expected = datetime.strptime(spec["datetime"], "%Y-%m-%d %H:%M")
            ok = dt is not None and dt.replace(second=0, microsecond=0) == expected
            return ok, f"应为 {spec['datetime']}，实际 {actual!r}"
        if "date" in spec:
            dt = _parse_dt(actual)
            return dt is not None and dt.date().isoformat() == spec["date"], f"日期应为 {spec['date']}，实际 {actual!r}"
        raise ValueError(f"不认识的参数匹配：{spec}")
    return actual == spec, f"应为 {spec!r}，实际 {actual!r}"


def _check_tool(calls: list, name: str, arg_specs: dict | None, refs: dict) -> tuple[bool, str]:
    matching = [c for c in calls if c["name"] == name]
    if not matching:
        called = "、".join(c["name"] for c in calls) or "没有调用工具"
        return False, f"没有调用 {name}（实际：{called}）"
    if not arg_specs:
        return True, f"调用了 {name}"
    reasons = []
    for call in matching:
        problems = []
        for key, spec in arg_specs.items():
            ok, why = _match_arg(call["args"].get(key), spec, refs)
            if not ok:
                problems.append(f"{key} {why}")
        if not problems:
            return True, f"调用了 {name}，参数正确"
        reasons.append("；".join(problems))
    return False, f"{name} 参数不对：{' | '.join(reasons)}"


async def _check_db(spec: dict) -> tuple[bool, str]:
    table = Base.metadata.tables.get(spec["table"])
    if table is None:
        raise ValueError(f"没有这张表：{spec['table']}")
    stmt = select(table)
    for col, value in spec.get("where", {}).items():
        stmt = stmt.where(table.c[col] == value)
    async with SessionLocal() as db:
        found = (await db.execute(stmt.limit(1))).first() is not None
    want = spec.get("exists", True)
    return found == want, f"{spec['table']} {spec.get('where')} 应{'存在' if want else '不存在'}，实际{'存在' if found else '不存在'}"


async def check_turn(expect: list, calls: list, reply: str, refs: dict, metrics: dict) -> list[tuple[bool, str]]:
    results = []
    for item in expect or []:
        if "no_call" in item:
            # 某种参数组合的调用不能出现（比如把提醒设在已经过去的时间）
            spec = item["no_call"]
            ok, _ = _check_tool(calls, spec["tool"], spec.get("args"), refs)
            results.append((not ok, f"不应出现这样的 {spec['tool']} 调用：{spec.get('args')}"))
        elif "only_tools" in item:
            extra = sorted({c["name"] for c in calls} - set(item["only_tools"]))
            results.append((not extra, f"只应调用 {item['only_tools']}，多调用了 {extra}"))
        elif "max_tool_calls" in item:
            n = len(calls)
            results.append((n <= item["max_tool_calls"], f"工具调用不超过 {item['max_tool_calls']} 次，实际 {n} 次"))
        elif "max_llm_calls" in item:
            n = metrics.get("llm_calls", 0)
            results.append((n <= item["max_llm_calls"], f"模型调用不超过 {item['max_llm_calls']} 次，实际 {n} 次"))
        elif "tool" in item:
            results.append(_check_tool(calls, item["tool"], item.get("args"), refs))
        elif "tool_any" in item:
            names = {c["name"] for c in calls}
            ok = bool(names & set(item["tool_any"]))
            results.append((ok, f"应调用 {item['tool_any']} 之一，实际 {sorted(names) or '没有调用工具'}"))
        elif "no_tool" in item:
            ok = all(c["name"] != item["no_tool"] for c in calls)
            results.append((ok, f"不应调用 {item['no_tool']}"))
        elif "no_tools" in item:
            ok = not calls
            results.append((ok, f"不应调用任何工具，实际 {[c['name'] for c in calls]}"))
        elif "reply_has" in item:
            ok = re.search(item["reply_has"], reply or "", re.I) is not None
            results.append((ok, f"回复应匹配 /{item['reply_has']}/"))
        elif "reply_not" in item:
            m = re.search(item["reply_not"], reply or "", re.I)
            results.append((m is None, f"回复不应匹配 /{item['reply_not']}/" + (f"，却出现了「{m.group(0)}」" if m else "")))
        elif "db" in item:
            results.append(await _check_db(item["db"]))
        else:
            raise ValueError(f"不认识的检查项：{item}")
    return results
