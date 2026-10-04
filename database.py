import os
from dotenv import load_dotenv
from sqlalchemy import event, Column, Integer, String, Text, DateTime, Date, Boolean, Index, ForeignKey, UniqueConstraint, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from pgvector.sqlalchemy import Vector
from services.clock import now as clock_now

# 自己加载一次 .env：谁先 import 这个模块都不影响（本地开发时变量在 .env 里，线上是真环境变量，load_dotenv 不会覆盖）
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://aichat:aichat@localhost:5432/aichat")

# 部署在 Vercel 上时（Vercel 运行时会设置 VERCEL=1），函数实例随请求起停、可能同时有好几个，
# 各自攒连接池会把 Supabase 会话模式 pooler 的连接数占满，所以用 NullPool：每个请求用完连接就关。
# 本地开发是常驻进程，继续用默认连接池，省掉每次建连接的开销。
ON_VERCEL = bool(os.getenv("VERCEL"))

# DB_SCHEMA：把所有表放到指定 schema 里，只给评测用（evals/ 设成 eval），评测跑出来的任务、记忆、轨迹不会混进真实数据；
# 线上和本地开发都不设。两层机制：
# 1. schema_translate_map：所有 ORM 语句在编译时就把表名写成 "eval.tasks" 这种全名，不依赖连接状态，这是主要保证；
# 2. search_path：给 Alembic 迁移和少数手写 SQL 用。必须用 run_async 直接在 asyncpg 连接上执行——
#    走 DBAPI cursor 的话 SET 会落在 SQLAlchemy 隐式开启的事务里，连接归还连接池时一回滚就失效了，
#    之后的语句会悄悄落回 public（2026-10-04 评测第一次跑时就因为这个误删过真实笔记）。
DB_SCHEMA = os.getenv("DB_SCHEMA")
if DB_SCHEMA and not DB_SCHEMA.isidentifier():
    raise ValueError(f"DB_SCHEMA 不合法：{DB_SCHEMA}")


def use_schema(async_engine) -> None:
    """给引擎的每个新连接设置 search_path（持久生效，不受事务回滚影响）。Alembic 自己建的引擎也要调一次。"""
    if not DB_SCHEMA:
        return

    @event.listens_for(async_engine.sync_engine, "connect")
    def _set_search_path(dbapi_connection, _record):
        dbapi_connection.run_async(lambda conn: conn.execute(f"SET search_path TO {DB_SCHEMA}, public"))


# 异步 Postgres 引擎
engine = create_async_engine(
    DATABASE_URL, echo=False, poolclass=NullPool if ON_VERCEL else None,
    execution_options={"schema_translate_map": {None: DB_SCHEMA}} if DB_SCHEMA else {},
)
use_schema(engine)

# 所有数据库模型的基类
Base = declarative_base()

# 会话工厂，用来创建数据库操作的 session
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# sessions 表：存储每个对话会话
class ChatSession(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(100), default="新对话")          # 会话标题
    created_at = Column(DateTime, default=clock_now)    # 创建时间
    def __repr__(self):
        return f"ChatSession(id={self.id}, title={self.title!r})"

# messages 表：存储每条消息
class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, index=True)                # 关联到哪个会话
    role = Column(String(20))                                # user 或 assistant
    content = Column(Text)                                   # 消息内容
    created_at = Column(DateTime, default=clock_now)      # 创建时间
    def __repr__(self):
        return f"Message(id={self.id}, session_id={self.session_id}, role={self.role!r}, content={self.content!r})"

# tasks 表：agent / 用户共同维护的任务列表
class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200))                              # 任务内容
    done = Column(Boolean, default=False)                     # 是否完成
    due_at = Column(DateTime, nullable=True)                  # 截止时间（可选）
    goal_id = Column(Integer, ForeignKey("goals.id", ondelete="SET NULL"), nullable=True, index=True)  # 挂靠的目标（可选）
    priority = Column(String(10), default="medium", server_default=text("'medium'"), nullable=False)  # high / medium / low
    estimate_minutes = Column(Integer, nullable=True)         # 预计花多少分钟（可选），任务页统计"计划时长"用
    planned_start = Column(DateTime, nullable=True)           # 计划几点开始做（可选），配合预计时长在总览"今日安排"里显示成时间块
    created_at = Column(DateTime, default=clock_now)
    updated_at = Column(DateTime, default=clock_now, onupdate=clock_now)
    def __repr__(self):
        return f"Task(id={self.id}, title={self.title!r}, done={self.done})"

# goals 表：三层目标——phase（阶段）没有上级，month（月目标）挂在某个 phase 下，
# week（周目标）挂在某个 month 下，parent_id 自引用表示这层挂靠关系。
# progress 是手动或者 agent 调用工具设定的百分比，不从关联任务的完成比例自动算，
# 因为目标进度往往不是子任务数量的线性函数（比如一个难任务没做完不代表只差一点）。
class Goal(Base):
    __tablename__ = "goals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    parent_id = Column(Integer, ForeignKey("goals.id", ondelete="CASCADE"), nullable=True, index=True)
    tier = Column(String(10), nullable=False)                 # phase / month / week
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)                  # 补充说明，比如"下一里程碑是什么"
    target_date = Column(DateTime, nullable=True)
    progress = Column(Integer, default=0)                       # 0-100
    status = Column(String(20), nullable=True)                  # 自由文本，比如"正常""轻度迟缓""证据不足"
    created_at = Column(DateTime, default=clock_now)
    updated_at = Column(DateTime, default=clock_now, onupdate=clock_now)
    def __repr__(self):
        return f"Goal(id={self.id}, tier={self.tier!r}, title={self.title!r}, progress={self.progress})"

# agent_traces 表：记录每一轮对话里 agent 的推理/工具调用步骤，用于可观测性
class AgentTrace(Base):
    __tablename__ = "agent_traces"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, index=True)                  # 关联到哪个会话
    turn_index = Column(Integer)                               # 这是本会话第几轮对话
    step_index = Column(Integer)                               # 本轮内的第几步
    type = Column(String(20))                                  # llm / tool_call / tool_result / final
    name = Column(String(100), nullable=True)                  # 工具名（llm、final 步骤为空）
    payload = Column(Text)                                      # JSON 序列化的详情
    duration_ms = Column(Integer, nullable=True)               # 这一步花了多久：llm 是一次模型调用，tool_result 是一次工具执行
    prompt_tokens = Column(Integer, nullable=True)             # 只有 llm 步骤有：这次模型调用的输入/输出 token
    completion_tokens = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=clock_now)
    def __repr__(self):
        return f"AgentTrace(session_id={self.session_id}, type={self.type!r}, name={self.name!r})"


# profile_facts 表：核心记忆，关于用户的一条条事实（身份、目标、偏好、近况）。
# 全部常驻在系统提示里，知行每次开口前就知道；知行在对话里发现新信息时自动增改，用户在"关于我"页也能改
class ProfileFact(Base):
    __tablename__ = "profile_facts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(20), nullable=False)               # identity / goal / preference / status
    content = Column(String(300), nullable=False)
    source = Column(String(10), default="agent", nullable=False)  # agent（知行记的）/ user（自己写的）
    created_at = Column(DateTime, default=clock_now)
    updated_at = Column(DateTime, default=clock_now, onupdate=clock_now)
    def __repr__(self):
        return f"ProfileFact({self.category}: {self.content!r})"

# notes 表：笔记 / 知识库（category='note'）和日记复盘（category='journal'）共用，
# 也是 Notion 只读导入（source='notion'）落地的表
class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200))
    content = Column(Text)
    category = Column(String(20), default="note")             # note / journal
    source = Column(String(20), default="local")               # local / notion
    external_id = Column(String(100), nullable=True, index=True)   # 来源系统里的 id（比如 Notion 页面 id）
    external_updated_at = Column(DateTime, nullable=True)       # 来源系统的最后编辑时间（UTC），用于增量同步判断
    structured_data = Column(Text, nullable=True)               # 日记复盘的引导问答+评分，JSON 文本，只有 journal 分类会用到
    url = Column(String(1000), nullable=True)                   # 资料库条目的原文链接（热点收藏、导入的网页、GitHub 仓库）
    created_at = Column(DateTime, default=clock_now)
    updated_at = Column(DateTime, default=clock_now, onupdate=clock_now)
    def __repr__(self):
        return f"Note(id={self.id}, title={self.title!r}, category={self.category!r})"

# note_chunks 表：一条笔记切成多个分块，每个分块一个向量，检索都在这张表上做。
# 长笔记不分块的话，embedding 模型只能处理约 512 个 token，超出部分会被截断，后半段就检索不到了。
class NoteChunk(Base):
    __tablename__ = "note_chunks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)              # 这是笔记的第几个分块，从 0 开始
    content = Column(Text)                                      # 分块原文，不含标题
    embedding = Column(Vector(512), nullable=False)             # 对"标题+换行+分块原文"算出的向量，512 维对应 bge-small-zh-v1.5
    def __repr__(self):
        return f"NoteChunk(note_id={self.note_id}, chunk_index={self.chunk_index})"

# HNSW 向量索引，配合 cosine_distance 查询用；声明在这里方便以后 Alembic 对比出漂移
Index(
    "ix_note_chunks_embedding_hnsw",
    NoteChunk.embedding,
    postgresql_using="hnsw",
    postgresql_ops={"embedding": "vector_cosine_ops"},
)

# memory_chunks 表：对话记忆。每轮对话结束后把"用户问的 + 知行答的"存一条、算一个向量，
# 知行需要回忆以前聊过什么时用 search_memory 工具检索。删会话时按 session_id 一起删
class MemoryChunk(Base):
    __tablename__ = "memory_chunks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, index=True, nullable=False)
    content = Column(Text, nullable=False)                      # "用户：…… 知行：……"一问一答，太长的截断
    embedding = Column(Vector(512), nullable=False)
    created_at = Column(DateTime, default=clock_now)
    def __repr__(self):
        return f"MemoryChunk(session_id={self.session_id}, id={self.id})"


Index(
    "ix_memory_chunks_embedding_hnsw",
    MemoryChunk.embedding,
    postgresql_using="hnsw",
    postgresql_ops={"embedding": "vector_cosine_ops"},
)

# reminders 表：日程提醒
class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message = Column(String(300))
    remind_at = Column(DateTime)
    fired = Column(Boolean, default=False)                    # 到期后由后台任务置 True，前端据此弹提示
    acknowledged = Column(Boolean, default=False, server_default=text("false"), nullable=False)  # 用户点了"知道了"，不再弹条幅，但保留历史
    created_at = Column(DateTime, default=clock_now)
    def __repr__(self):
        return f"Reminder(id={self.id}, message={self.message!r}, remind_at={self.remind_at})"

# daily_digests 表：知行每天主动生成的一份简报（今日待办 + 提醒），一天一条，重复生成会覆盖同一天的记录
class DailyDigest(Base):
    __tablename__ = "daily_digests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    digest_date = Column(Date, unique=True, index=True, nullable=False)
    content = Column(Text)
    created_at = Column(DateTime, default=clock_now)
    def __repr__(self):
        return f"DailyDigest(digest_date={self.digest_date})"

# hot_topics 表：每天收集一次的 AI/agent 领域热点（GitHub 上新出现的相关仓库 + 联网搜到的新闻），
# 同样一天一条，items 是 DeepSeek 挑选、写好一句话理由之后的 JSON 列表
class HotTopics(Base):
    __tablename__ = "hot_topics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_date = Column(Date, unique=True, index=True, nullable=False)
    items = Column(Text)
    created_at = Column(DateTime, default=clock_now)
    def __repr__(self):
        return f"HotTopics(topic_date={self.topic_date})"

# message_feedback 表：用户对某一轮回复的点赞/点踩（第四层评测：线上反馈回流）。
# 用 (会话, 轮次) 定位，跟 agent_traces 一致，执行轨迹页能直接把反馈和那一轮的步骤对上；同一轮再点一次就覆盖
class MessageFeedback(Base):
    __tablename__ = "message_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, nullable=False, index=True)
    turn_index = Column(Integer, nullable=False)
    rating = Column(String(10), nullable=False)               # up / down
    reason = Column(String(20), nullable=True)                # 点踩原因：wrong / fabricated / missed_tool / verbose / other
    comment = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=clock_now)
    updated_at = Column(DateTime, default=clock_now, onupdate=clock_now)
    __table_args__ = (UniqueConstraint("session_id", "turn_index", name="uq_feedback_turn"),)
    def __repr__(self):
        return f"MessageFeedback({self.session_id}/{self.turn_index}: {self.rating})"

# eval_candidates 表：标记成"要变成评测用例"的轮次。导出脚本（evals/pull_candidates.py）把它们连同
# 提问、实际调用和回复写成 YAML 草稿，人补上期望之后再并进用例集
class EvalCandidate(Base):
    __tablename__ = "eval_candidates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, nullable=False)
    turn_index = Column(Integer, nullable=False)
    note = Column(String(500), nullable=True)                 # 为什么要做成用例、期望应该是什么
    exported = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=clock_now)
    __table_args__ = (UniqueConstraint("session_id", "turn_index", name="uq_candidate_turn"),)
    def __repr__(self):
        return f"EvalCandidate({self.session_id}/{self.turn_index})"

# auth_sessions 表：登录会话。cookie 里是随机令牌，这里只存它的 sha256，库泄露了也拿不到能用的 cookie。
# 每台设备登录一次一条，单独删一条就是让那台设备下线
class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    user_agent = Column(String(300))
    ip = Column(String(64))
    created_at = Column(DateTime, default=clock_now)
    last_seen_at = Column(DateTime, default=clock_now)
    expires_at = Column(DateTime, nullable=False)
    def __repr__(self):
        return f"AuthSession(id={self.id}, expires_at={self.expires_at})"

# login_attempts 表：登录尝试记录，用来限流（同一 IP 连错 5 次锁 15 分钟，全局每小时失败过多暂停登录）。
# 放数据库而不是内存，因为 Vercel 上每个请求可能落在不同的函数实例
class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ip = Column(String(64), index=True)
    success = Column(Boolean, nullable=False)
    created_at = Column(DateTime, default=clock_now, index=True)
    def __repr__(self):
        return f"LoginAttempt({self.ip}, success={self.success})"

# 只负责确保 pgvector 扩展存在，每次启动跑一遍也没问题（幂等）。
# 表结构本身不在这里建，改由 Alembic 管理（首次用 alembic upgrade head 建表，
# 以后任何表结构改动都是改 model 再 alembic revision --autogenerate），
# 避免 create_all 和迁移工具各管一套、互相打架。
async def init_db():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
