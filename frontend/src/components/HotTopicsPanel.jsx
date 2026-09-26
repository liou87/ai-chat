import { useState, useEffect } from "react"
import { useTheme } from "../ThemeContext"
import { API, authHeaders } from "../api"

// 每天收集一次的 AI/agent 领域热点（GitHub 新仓库 + 联网搜到的新闻，DeepSeek 挑过并写了一句话理由），
// 纯展示，点条目直接跳转原链接。独立成侧栏页面，不再挤在总览里。
function HotTopicsPanel() {
  const { colors } = useTheme()
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/hot-topics/today`, { headers: authHeaders })
      .then(res => res.json())
      .then(data => { if (!cancelled) setItems(data?.items || []) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div style={{ color: colors.textMuted }}>收集中...</div>
  if (!items?.length) return <div style={{ color: colors.textMuted }}>今天还没收集到</div>

  return (
    <div>
      {items.map((it, i) => (
        <a
          key={i}
          href={it.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "block",
            padding: "14px 0",
            borderBottom: i < items.length - 1 ? `1px solid ${colors.borderLight}` : "none",
            textDecoration: "none",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>{it.title}</div>
          {it.summary && <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 1.5 }}>{it.summary}</div>}
        </a>
      ))}
    </div>
  )
}

export default HotTopicsPanel
