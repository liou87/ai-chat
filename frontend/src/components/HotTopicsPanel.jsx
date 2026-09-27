import { useState, useEffect } from "react"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { apiFetch } from "../api"
import { formatShort } from "../datetime"
import LoadError from "./LoadError"

// 每天收集一次的 AI/agent 领域热点（GitHub 新仓库 + 联网搜到的新闻，DeepSeek 挑过并写了一句话理由），
// 点条目直接跳转原链接。顶部可以切换日期看历史，今天的可以手动重新收集。
function HotTopicsPanel() {
  const { colors, inputStyle, buttonStyle, panelCardStyle } = useTheme()
  const confirm = useConfirm()
  const [dates, setDates] = useState([])
  const [day, setDay] = useState("today")   // "today" 或者 "YYYY-MM-DD"
  const [data, setData] = useState(null)     // { topic_date, items, created_at }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)  // 点"重试"时 +1，重新触发请求
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch(day === "today" ? "/hot-topics/today" : `/hot-topics/${day}`)
      .then(result => { if (!cancelled) setData(result) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [day, attempt])

  // 日期列表只在首次和今天的数据刷新后拉，今天第一次打开时"今天"这条是刚生成的
  useEffect(() => {
    apiFetch("/hot-topics/dates").then(setDates).catch(() => {})
  }, [data?.topic_date])

  const switchDay = (value) => {
    setLoading(true)
    setError(null)
    setDay(value)
  }

  const regenerate = async () => {
    if (!(await confirm({ title: "重新收集今天的热点", message: "会重新搜索 GitHub 和新闻并让 DeepSeek 筛选，覆盖今天已有的结果，会消耗一次 Tavily 和 DeepSeek 额度。", confirmText: "重新收集" }))) return
    setRegenerating(true)
    setError(null)
    try {
      setData(await apiFetch("/hot-topics/today/regenerate", { method: "POST" }))
    } catch (e) {
      setError(e.message)
    } finally {
      setRegenerating(false)
    }
  }

  const isToday = day === "today"
  const items = data?.items || []
  // 日期下拉里"今天"单独一项，其余是有记录的历史日期
  const historyDates = dates.filter(d => d !== todayString())

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={day} onChange={e => switchDay(e.target.value)} aria-label="选择日期" style={{ ...inputStyle, width: "auto" }}>
          <option value="today">今天</option>
          {historyDates.map(d => <option key={d} value={d}>{formatShort(d, { withTime: false })}</option>)}
        </select>
        {data?.created_at && !loading && (
          <span style={{ fontSize: 12, color: colors.textMuted }}>{formatShort(data.created_at)} 收集</span>
        )}
        {isToday && (
          <button
            onClick={regenerate}
            disabled={regenerating || loading}
            style={{ ...buttonStyle, fontSize: 13, padding: "5px 10px", marginLeft: "auto", cursor: regenerating ? "wait" : "pointer", opacity: regenerating || loading ? 0.6 : 1 }}
          >
            {regenerating ? "收集中..." : "重新收集"}
          </button>
        )}
      </div>

      {(loading || regenerating) && <div style={{ color: colors.textMuted }}>收集中...</div>}
      {!loading && !regenerating && error && (
        <LoadError message={error} onRetry={() => { setLoading(true); setError(null); setAttempt(a => a + 1) }} />
      )}
      {!loading && !regenerating && !error && items.length === 0 && (
        <div style={{ color: colors.textMuted }}>{isToday ? "今天还没收集到" : "这一天没有收集到内容"}</div>
      )}

      {!loading && !regenerating && !error && items.length > 0 && (
      <div style={{ ...panelCardStyle, padding: "4px 22px" }}>
      {items.map((it, i) => (
        <a
          key={i}
          href={it.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "block",
            padding: "16px 0",
            borderBottom: i < items.length - 1 ? `1px solid ${colors.borderLight}` : "none",
            textDecoration: "none",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>{it.title}</div>
          {it.summary && <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 1.5 }}>{it.summary}</div>}
        </a>
      ))}
      </div>
      )}
    </div>
  )
}

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default HotTopicsPanel
