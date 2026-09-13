from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from sqlalchemy.orm import declarative_base
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from datetime import datetime

# 创建异步 SQLite 引擎，文件保存在当前目录的 chat.db
engine = create_async_engine("sqlite+aiosqlite:///chat.db", echo=False)

# 所有数据库模型的基类
Base = declarative_base()

# 会话工厂，用来创建数据库操作的 session
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# sessions 表：存储每个对话会话
class ChatSession(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(100), default="新对话")          # 会话标题
    created_at = Column(DateTime, default=datetime.now)    # 创建时间
    def __repr__(self):
        return f"ChatSession(id={self.id}, title={self.title!r})"

# messages 表：存储每条消息
class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, index=True)                # 关联到哪个会话
    role = Column(String(20))                                # user 或 assistant
    content = Column(Text)                                   # 消息内容
    created_at = Column(DateTime, default=datetime.now)      # 创建时间
    def __repr__(self):
        return f"Message(id={self.id}, session_id={self.session_id}, role={self.role!r}, content={self.content!r})"

# tasks 表：agent / 用户共同维护的任务列表
class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200))                              # 任务内容
    done = Column(Boolean, default=False)                     # 是否完成
    due_at = Column(DateTime, nullable=True)                  # 截止时间（可选）
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    def __repr__(self):
        return f"Task(id={self.id}, title={self.title!r}, done={self.done})"

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
    created_at = Column(DateTime, default=datetime.now)
    def __repr__(self):
        return f"AgentTrace(session_id={self.session_id}, type={self.type!r}, name={self.name!r})"

# notes 表：笔记 / 知识库（category='note'）和日记复盘（category='journal'）共用
class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200))
    content = Column(Text)
    category = Column(String(20), default="note")             # note / journal
    embedding = Column(Text, nullable=True)                     # JSON 序列化的向量，用于语义检索
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    def __repr__(self):
        return f"Note(id={self.id}, title={self.title!r}, category={self.category!r})"

# reminders 表：日程提醒
class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message = Column(String(300))
    remind_at = Column(DateTime)
    fired = Column(Boolean, default=False)                    # 到期后由后台任务置 True，前端据此弹提示
    created_at = Column(DateTime, default=datetime.now)
    def __repr__(self):
        return f"Reminder(id={self.id}, message={self.message!r}, remind_at={self.remind_at})"

# 创建所有表
async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
