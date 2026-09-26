// 后端地址走环境变量：本地 .env 里填 http://127.0.0.1:8000/api，Vercel 上填线上地址；
// 没配的时候退回线上地址，免得忘了配变量时整个前端连不上
export const API = import.meta.env.VITE_API_URL || "https://ai-chat-production-5293.up.railway.app/api"
export const API_KEY = import.meta.env.VITE_API_KEY
export const authHeaders = { "X-API-Key": API_KEY }

// 统一的请求函数：自动带鉴权头、JSON 请求体，非 2xx 直接抛错（带上后端的 detail），
// 调用方不用再各自判断 res.ok，也不会把 {detail: ...} 这种错误对象当成列表数据去 .filter 导致白屏
export async function apiFetch(path, { method = "GET", body, params } = {}) {
  const url = new URL(`${API}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, v)
    }
  }
  const headers = { ...authHeaders }
  if (body !== undefined) headers["Content-Type"] = "application/json"

  let res
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch {
    throw new Error("连不上服务器，请检查网络")
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : null
    throw new Error(detail || (res.status === 401 ? "API Key 不正确" : `请求失败（${res.status}）`))
  }
  return data
}
