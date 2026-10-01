import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// 本地开发时把 /api 转给本地 uvicorn，前端和接口看起来是同一个域名，跟线上 Vercel 一样，
// 登录 cookie 才能正常带上（跨域名的话 SameSite=Strict 的 cookie 不会发）。后端端口不是 8000 时用 BACKEND_URL 改
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.BACKEND_URL || 'http://127.0.0.1:8000',
    },
  },
})
