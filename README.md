# AI Chat

基于 DeepSeek API 的全栈 AI 对话应用，支持多轮对话和历史会话管理。

## 功能特性

- 多轮对话，AI 记忆上下文
- 历史会话自动保存
- 侧边栏切换不同会话
- Markdown 格式渲染

## 技术栈

- 后端：Python + FastAPI + SQLAlchemy + SQLite
- 前端：React + Vite
- AI：DeepSeek API
- 部署：Railway（后端）+ Vercel（前端）

## 线上地址

- 前端：https://ai-chat-frontend-liard.vercel.app
- 后端 API 文档：https://ai-chat-production-5293.up.railway.app/docs

## 本地运行

**后端**

```bash
pip install -r requirements.txt
# 在 .env 文件中配置 DEEPSEEK_API_KEY
uvicorn main:app --reload
```

**前端**

```bash
npm install
npm run dev
```

## 项目结构

```
AI-Chat/
├── main.py              # FastAPI 入口
├── database.py          # 数据库模型
├── routers/
│   ├── chat.py          # 对话接口
│   └── sessions.py      # 历史记录接口
├── services/
│   └── llm.py           # DeepSeek 调用
└── requirements.txt
```
