import { useEffect, useState } from "react"
import { apiFetch, AUTH_REQUIRED_EVENT } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { formatShort } from "../datetime"
import { Badge } from "./ui"

// 从 User-Agent 里粗略认出"什么浏览器 · 什么系统"，够分辨是哪台设备就行
function describeDevice(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "浏览器"
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "未知系统"
  return `${browser} · ${os}`
}

// "关于我"页底部的登录设备：哪些设备登录着、最近什么时候用过；可以单独让某台下线、其它全部下线、退出当前设备
function DevicesCard() {
  const { colors, panelCardStyle, buttonStyle } = useTheme()
  const confirm = useConfirm()
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      setSessions(await apiFetch("/auth/sessions"))
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [])

  const act = async (fn) => {
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const logout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" })
    } finally {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
    }
  }

  // 本地开发没开登录时没有会话记录，整块不显示
  if (sessions && sessions.length === 0 && !error) return null
  const others = (sessions ?? []).filter(s => !s.current)

  return (
    <div style={{ ...panelCardStyle, padding: "16px 20px 12px", marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>登录设备</span>
        <span style={{ fontSize: 12, color: colors.textMuted }}>30 天没用会自动失效</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {others.length > 0 && (
            <button
              onClick={async () => {
                if (await confirm({ title: "其它设备全部下线", message: `除了这台，其它 ${others.length} 个登录都会失效，需要重新输密码。` })) {
                  act(() => apiFetch("/auth/sessions/revoke-others", { method: "POST" }))
                }
              }}
              style={{ ...buttonStyle, fontSize: 12.5, padding: "4px 10px" }}
            >
              其它设备全部下线
            </button>
          )}
          <button onClick={logout} style={{ ...buttonStyle, fontSize: 12.5, padding: "4px 10px" }}>退出登录</button>
        </div>
      </div>
      {error && <div style={{ fontSize: 13, color: colors.danger, padding: "6px 0" }}>{error}</div>}
      {sessions == null && !error && <div style={{ fontSize: 13, color: colors.textMuted, padding: "6px 0" }}>加载中…</div>}
      {(sessions ?? []).map(s => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${colors.borderLight}` }}>
          <span style={{ fontSize: 14, color: colors.text }}>{describeDevice(s.user_agent)}</span>
          {s.current && <Badge tone="ink">当前设备</Badge>}
          <span style={{ fontSize: 12, color: colors.textMuted }}>
            {s.ip} · 最近使用 {formatShort(s.last_seen_at)} · 登录于 {formatShort(s.created_at, { withTime: false })}
          </span>
          {!s.current && (
            <button
              onClick={() => act(() => apiFetch(`/auth/sessions/${s.id}`, { method: "DELETE" }))}
              style={{ marginLeft: "auto", border: "none", background: "none", color: colors.danger, cursor: "pointer", fontSize: 12.5 }}
            >
              下线
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export default DevicesCard
