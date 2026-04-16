# AI Chat

基于 DeepSeek API 的全栈 AI 对话应用。

## 技术栈

- 后端：Python + FastAPI + SQLAlchemy
- 前端：React + Vite
- AI：DeepSeek API
- 数据库：SQLite
- 部署：Railway（后端）+ Vercel（前端）

## 线上地址

- 前端：https://ai-chat-frontend-liard.vercel.app
- 后端 API：https://ai-chat-production-5293.up.railway.app/docs

## 本地运行

后端：

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

前端：

```bash
npm install
npm run dev
```
