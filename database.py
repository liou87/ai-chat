from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

# 创建 SQLite 数据库，文件保存在当前目录的 chat.db
engine = create_engine("sqlite:///chat.db", echo=False)

# 所有数据库模型的基类
Base = declarative_base()

# 会话工厂，用来创建数据库操作的 session
SessionLocal = sessionmaker(bind=engine)

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
    session_id = Column(Integer)                           # 关联到哪个会话
    role = Column(String(20))                              # user 或 assistant
    content = Column(Text)                                 # 消息内容
    created_at = Column(DateTime, default=datetime.now)    # 创建时间
    def __repr__(self):
        return f"Message(id={self.id}, session_id={self.session_id}, role={self.role!r}, content={self.content!r})"

# 创建所有表
def init_db():
    Base.metadata.create_all(engine)