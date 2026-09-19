# AI Chat

基于 DeepSeek API 的个人工作台 agent 平台：聊天是入口，AI 通过 function calling 管理任务、笔记（语义检索）、日记复盘、日程提醒，并能联网搜索。详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 功能特性

- 多轮对话，AI 记忆上下文，支持流式回复
- Agent 工具调用：建任务/查任务、记笔记/语义搜索笔记、记日记/生成周复盘、设提醒、联网搜索、同步 Notion 笔记
- 笔记按段落和标题分块后做向量检索，长笔记的后半段也能被搜到；Notion 数据库只读导入，增量同步，Notion 里删掉的页面本地副本也会清理
- 每轮对话的工具调用过程可追溯（`agent_traces` 表）
- 历史会话自动保存，聊天面板里可切换
- 工作台总览（任务/笔记/日记/提醒四张卡片），图标栏可切到单模块全页视图，跟聊天里的操作实时同步
- 聊天面板固定在右侧，可折叠；支持亮/暗主题切换
- Markdown 格式渲染

## 技术栈

- 后端：Python 3.11 + FastAPI（全异步）+ SQLAlchemy + Alembic + APScheduler
- 数据库：PostgreSQL + pgvector（当前托管在 Supabase）
- AI：DeepSeek API（function calling）+ fastembed（本地中文 embedding）+ Tavily（联网搜索）
- 前端：React 19 + Vite
- 部署：Railway（后端）+ Vercel（前端）

## 线上地址

- 前端：https://ai-chat-frontend-liard.vercel.app
- 后端 API 文档：https://ai-chat-production-5293.up.railway.app/docs

## 本地运行

**后端**（需要 Python 3.10+，本机用的是 `.venv`）

```bash
py -3.10 -m venv .venv
./.venv/Scripts/pip install -r requirements.txt
# 在 .env 文件中配置 DEEPSEEK_API_KEY / DATABASE_URL / API_KEY / TAVILY_API_KEY，需要 Notion 同步的话再配置 NOTION_API_KEY 和 NOTION_DATABASE_ID
# DATABASE_URL 形如 postgresql+asyncpg://user:pass@host:5432/dbname，需要数据库已支持 pgvector
./.venv/Scripts/python.exe -m alembic upgrade head    # 首次运行先建表
./.venv/Scripts/python.exe -m uvicorn main:app --reload
```

**前端**

```bash
cd frontend
npm install
# 在 .env 文件中配置 VITE_API_KEY（要和后端 API_KEY 一致）
npm run dev
```

## 项目结构

```
AI-Chat/
├── main.py                # FastAPI 入口
├── database.py            # 数据库模型（sessions/messages/tasks/notes/reminders/agent_traces）
├── migrations/            # Alembic 迁移脚本（配置见 alembic.ini）
├── routers/                # chat / sessions / tasks / notes / reminders
├── services/                # 业务逻辑 + agent 核心循环 + 工具注册表
├── frontend/                # React + Vite，见 frontend/src/components
├── docs/                    # 架构文档 + specs/ 下的功能设计文档
└── requirements.txt
```

完整的架构说明、数据模型、agent 工具清单、API 列表、已知限制见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
