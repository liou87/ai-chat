// 后端地址：线上前后端同一个域名，/api 由 Python 函数处理；本地开发时 Vite 把 /api 代理到 uvicorn（见 vite.config.js），
// 所以默认相对路径就行。VITE_API_URL 只在特殊情况下覆盖，跨域名的话登录 cookie 带不过去
export const API = import.meta.env.VITE_API_URL || "/api"

// 鉴权靠登录后后端发的 httpOnly cookie（同域名，浏览器自动带上），前端代码里不放任何密钥。
// 任何接口返回 401 都广播这个事件，AuthGate 收到就切回登录页
export const AUTH_REQUIRED_EVENT = "auth:required"

export function checkUnauthorized(res) {
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  return res
}

// 给 AI SDK 的 transport 和直接用 fetch 的地方（上传 PDF）用：跟原生 fetch 一样，只是多了 401 检查
export const authFetch = (...args) => fetch(...args).then(checkUnauthorized)

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
  const headers = {}
  if (body !== undefined) headers["Content-Type"] = "application/json"

  let res
  try {
    res = await authFetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch {
    throw new Error("连不上服务器，请检查网络")
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : null
    throw new Error(detail || (res.status === 401 ? "请先登录" : `请求失败（${res.status}）`))
  }
  return data
}
