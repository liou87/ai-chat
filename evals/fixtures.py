"""
评测用的固定数据：每条用例开始前把 eval schema 里的可变数据恢复成同一个初始状态，结果才可比。

- 笔记、对话记忆要算向量（调 Voyage），只在第一次 seed_static() 时写入，之后保留；
- 任务、目标、提醒、核心记忆、会话、轨迹每条用例前 reset_state() 清空重建（TRUNCATE + 插入，不调外部接口）；
- 用例运行中新建的笔记、对话记忆，reset 时按"不在初始集合里"删掉。
"""
import json
from datetime import datetime, timedelta
from sqlalchemy import select, text
from database import (Base, ChatSession, DB_SCHEMA, engine, Goal, HotTopics, MemoryChunk, Note, ProfileFact,
                      Reminder, SessionLocal, Task)
from services import clock
from services import memory as memory_service
from services.notes import notes as notes_service

# 评测里的"现在"：2026-10-06 周二上午 10 点（悉尼时间）。"明天"= 10-07 周三，"这周五"= 10-09，"下周一"= 10-12
FROZEN_NOW = datetime(2026, 10, 6, 10, 0)

# 以前的一段对话，给 search_memory 用例检索。session id 固定成一个大数，跟每次 reset 后从 1 开始的新会话不冲突
PAST_SESSION_ID = 9001
PAST_SESSION_TITLE = "面试安排"
PAST_TURN = ("我下周三要去 Atlassian 面 AI 工程师实习，二面是系统设计",
             "好的，Atlassian 的二面系统设计可以重点准备：如何设计一个带工具调用的 agent 服务、"
             "怎么做限流和可观测性。我们可以按这个方向列个准备清单。")

NOTES = [
    ("KV Cache 原理笔记", "note",
     "KV Cache 是大模型推理加速的关键技术。自回归生成时，每生成一个新 token 都要对之前所有 token 做注意力计算，"
     "如果每次都重新计算历史 token 的 Key 和 Value 会有大量重复计算。KV Cache 把已经算过的 K、V 缓存下来，"
     "新 token 只需要算自己的 Q、K、V，再和缓存拼接，复杂度从 O(n²) 降到 O(n)。代价是显存占用随序列长度线性增长，"
     "所以有 PagedAttention（vLLM）按页管理显存、MQA/GQA 减少 KV 头数等优化。"),
    ("LangGraph 核心概念速查", "note",
     "LangGraph 用图来编排 agent：节点（node）是一个函数，边（edge）决定下一步走哪个节点，条件边根据状态分支。"
     "State 是在节点之间传递的共享状态，用 TypedDict 定义，reducer 决定多个节点写同一字段时怎么合并。"
     "checkpointer 负责在每一步之后把状态持久化，用来实现多轮对话记忆、中断后恢复和 human-in-the-loop："
     "执行到 interrupt 时暂停，等人确认后从检查点继续。常用 MemorySaver（内存）和 PostgresSaver。"),
    ("简历项目经历草稿", "note",
     "项目一：知行个人 agent 工作台。亮点：手写 ReAct 循环、23 个工具、分层记忆、RAG 带出处、执行轨迹。"
     "项目二：CareerMatch 岗位匹配系统，用 embedding 做简历和 JD 的语义匹配，召回后用 LLM 重排。"
     "还缺：量化指标，需要补评测数据。"),
    ("2026-10-05 日记", "journal",
     "今天把 LangGraph 的 checkpointer 看完了，但 human-in-the-loop 的 interrupt 还没跑通。"
     "精力一般，下午效率低。明天先把简历改完。"),
]

PROFILE = [
    ("identity", "计算机硕士在读，人在悉尼"),
    ("goal", "在找 agent 开发方向的实习"),
    ("preference", "回答简洁，先给结论再展开"),
]

HOT_TOPICS = [
    {"kind": "news", "title": "谷歌开源 RRSI：让智能体自我改进 harness", "url": "https://example.com/news/rrsi",
     "summary": "不改模型权重，只让 agent 迭代自己的提示词、工具和记忆，用正则化思路防止过拟合评测集。",
     "source": "example.com", "published_date": "2026-10-05"},
    {"kind": "news", "title": "OpenAI 发布常驻智能体产品 Dots", "url": "https://example.com/news/dots",
     "summary": "主打长期运行的个人 agent，可跨应用执行研究和开发任务。", "source": "example.com",
     "published_date": "2026-10-05"},
    {"kind": "github", "title": "acme/agent-evals", "url": "https://github.com/acme/agent-evals",
     "summary": "轻量的 agent 行为回归评测框架，用 YAML 写用例、断言工具调用。", "stars": 820},
]


def _today_at(days: int, hour: int, minute: int = 0) -> datetime:
    d = FROZEN_NOW.date() + timedelta(days=days)
    return datetime(d.year, d.month, d.day, hour, minute)


async def assert_isolated() -> None:
    """确认连的是评测 schema，而且每张表都建在里面（否则 search_path 会落到 public 的真实数据上）。"""
    if DB_SCHEMA != "eval":
        raise SystemExit("评测必须在 DB_SCHEMA=eval 下运行")
    if engine.get_execution_options().get("schema_translate_map") != {None: "eval"}:
        raise SystemExit("数据库引擎没有把表名映射到 eval schema，拒绝运行")
    async with SessionLocal() as db:
        existing = set((await db.execute(text(
            "select table_name from information_schema.tables where table_schema = :s"), {"s": DB_SCHEMA}
        )).scalars().all())
    missing = set(Base.metadata.tables) - existing
    if missing:
        raise SystemExit(f"eval schema 里缺这些表：{sorted(missing)}，先跑 DB_SCHEMA=eval alembic upgrade head")


async def seed_static() -> None:
    """笔记、对话记忆、热点：不存在才写（要调 Voyage 算向量），之后每次 reset 都保留。"""
    async with SessionLocal() as db:
        have = set((await db.execute(select(Note.title))).scalars().all())
        for title, category, content in NOTES:
            if title not in have:
                await notes_service.create_note(db, title=title, content=content, category=category,
                                                created_at=FROZEN_NOW - timedelta(days=1))
        has_memory = (await db.execute(
            select(MemoryChunk.id).where(MemoryChunk.session_id == PAST_SESSION_ID))).first()
        if not has_memory:
            await memory_service.remember_turn(db, PAST_SESSION_ID, *PAST_TURN)
            await db.execute(text(f"update {DB_SCHEMA}.memory_chunks set created_at = :t where session_id = :s"),
                             {"t": FROZEN_NOW - timedelta(days=6), "s": PAST_SESSION_ID})
            await db.commit()
        if not (await db.execute(select(HotTopics).where(HotTopics.topic_date == FROZEN_NOW.date()))).first():
            db.add(HotTopics(topic_date=FROZEN_NOW.date(), items=json.dumps(HOT_TOPICS, ensure_ascii=False),
                             created_at=FROZEN_NOW - timedelta(hours=2)))
            await db.commit()


async def reset_state() -> None:
    """每条用例前调用：可变数据恢复成初始状态。表名都带 schema 前缀，绝不会碰到 public。"""
    s = DB_SCHEMA
    async with SessionLocal() as db:
        await db.execute(text(
            f"TRUNCATE {s}.tasks, {s}.goals, {s}.reminders, {s}.profile_facts, {s}.sessions, {s}.messages, "
            f"{s}.agent_traces RESTART IDENTITY CASCADE"))
        # 删除一律写 schema 全名，不依赖任何连接状态
        await db.execute(text(f"DELETE FROM {s}.notes WHERE NOT (title = ANY(:titles))"),
                         {"titles": [n[0] for n in NOTES]})
        await db.execute(text(f"DELETE FROM {s}.memory_chunks WHERE session_id <> :sid"), {"sid": PAST_SESSION_ID})

        db.add(ChatSession(id=PAST_SESSION_ID, title=PAST_SESSION_TITLE, created_at=FROZEN_NOW - timedelta(days=6)))
        phase = Goal(tier="phase", title="拿到 agent 开发实习 offer", progress=20, status="正常",
                     created_at=FROZEN_NOW - timedelta(days=30))
        db.add(phase)
        await db.flush()
        resume_goal = Goal(tier="month", parent_id=phase.id, title="完成简历", progress=40,
                           created_at=FROZEN_NOW - timedelta(days=10))
        db.add(resume_goal)
        await db.flush()

        tasks = [
            Task(title="简历修改", priority="high", estimate_minutes=60, goal_id=resume_goal.id,
                 due_at=_today_at(3, 18)),
            Task(title="准备 LangGraph 面试题", priority="medium", estimate_minutes=90, due_at=_today_at(7, 18)),
            Task(title="买牛奶", priority="low"),
            Task(title="读完 ReAct 论文", done=True, updated_at=FROZEN_NOW - timedelta(days=2)),
        ]
        for i, t in enumerate(tasks):
            t.created_at = FROZEN_NOW - timedelta(days=5 - i)
            t.updated_at = t.updated_at or t.created_at
            db.add(t)
        db.add(Reminder(message="组会", remind_at=_today_at(1, 14), created_at=FROZEN_NOW - timedelta(days=1)))
        db.add(Reminder(message="交房租", remind_at=_today_at(4, 9), created_at=FROZEN_NOW - timedelta(days=1)))
        for category, content in PROFILE:
            db.add(ProfileFact(category=category, content=content, source="agent",
                               created_at=FROZEN_NOW - timedelta(days=7), updated_at=FROZEN_NOW - timedelta(days=7)))
        await db.commit()


async def resolve_refs() -> dict:
    """用例里写 {ref: "task:买牛奶"} 这种引用，按标题/内容换成实际 id。"""
    refs = {}
    async with SessionLocal() as db:
        for t in (await db.execute(select(Task))).scalars():
            refs[f"task:{t.title}"] = t.id
        for g in (await db.execute(select(Goal))).scalars():
            refs[f"goal:{g.title}"] = g.id
        for r in (await db.execute(select(Reminder))).scalars():
            refs[f"reminder:{r.message}"] = r.id
        for f in (await db.execute(select(ProfileFact))).scalars():
            refs[f"fact:{f.content}"] = f.id
    return refs


def freeze_clock() -> None:
    clock.freeze(FROZEN_NOW)
