// 后端地址：部署在 Vercel 上时前后端同一个域名，/api 由 Python 函数处理，默认用相对路径就行，不用配变量；
// 本地开发时 Vite 和 uvicorn 是两个端口，在 frontend/.env 里配 VITE_API_URL=http://127.0.0.1:8000/api
export const API = import.meta.env.VITE_API_URL || "/api"
export const API_KEY = import.meta.env.VITE_API_KEY
export const authHeaders = { "X-API-Key": API_KEY }

// 统一的请求函数：自动带鉴权头、JSON 请求体，非 2xx 直接抛错（带上后端的 detail），
// 调用方不用再各自判断 res.ok，也不会把 {detail: ...} 这种错误对象当成列表数据去 .filter 导致白屏
export async function apiFetch(path, { method = "GET", body, params } = {}) {
  // 第二个参数是相对路径时的基准：API 是 "/api" 这种相对地址时按当前页面的域名补全，是完整地址时忽略
  const url = new URL(`${API}${path}`, window.location.origin)
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
