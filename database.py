import os
from sqlalchemy import Column, Integer, String, Text, DateTime, Date, Boolean, Index, ForeignKey, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from pgvector.sqlalchemy import Vector
from services.clock import now as clock_now

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://aichat:aichat@localhost:5432/aichat")

# 异步 Postgres 引擎
engine = create_async_engine(DATABASE_URL, echo=False)

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
    type = Column(String(20))                                  # tool_call / tool_result / final
    name = Column(String(100), nullable=True)                  # 工具名（final 步骤为空）
    payload = Column(Text)                                      # JSON 序列化的详情
    created_at = Column(DateTime, default=clock_now)
    def __repr__(self):
        return f"AgentTrace(session_id={self.session_id}, type={self.type!r}, name={self.name!r})"

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

# 只负责确保 pgvector 扩展存在，每次启动跑一遍也没问题（幂等）。
# 表结构本身不在这里建，改由 Alembic 管理（首次用 alembic upgrade head 建表，
# 以后任何表结构改动都是改 model 再 alembic revision --autogenerate），
# 避免 create_all 和迁移工具各管一套、互相打架。
async def init_db():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
