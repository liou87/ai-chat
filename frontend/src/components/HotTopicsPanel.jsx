import { useState, useEffect } from "react"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { apiFetch } from "../api"
import { formatShort } from "../datetime"
import LoadError from "./LoadError"

// 每天收集一次的 AI/agent 领域热点（GitHub 新仓库 + 联网搜到的新闻，DeepSeek 挑过并写了一句话理由），
// 点条目直接跳转原链接。顶部可以切换日期看历史，今天的可以手动重新收集。
function HotTopicsPanel({ onAnalyze }) {
  const { colors, inputStyle, buttonStyle } = useTheme()
  const confirm = useConfirm()
  const [dates, setDates] = useState([])
  const [day, setDay] = useState("today")   // "today" 或者 "YYYY-MM-DD"
  const [data, setData] = useState(null)     // { topic_date, items, created_at }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)  // 点"重试"时 +1，重新触发请求
  // 收藏状态：url -> "saving" | "saved" | 出错信息。已经在资料库里的链接一进来就标成已收藏
  const [saveState, setSaveState] = useState({})

  useEffect(() => {
    apiFetch("/library")
      .then(list => setSaveState(Object.fromEntries(list.filter(i => i.url).map(i => [i.url, "saved"]))))
      .catch(() => {})
  }, [])

  // 收藏进资料库：抓原文（仓库取 README）、分块建索引，知行以后能检索到；热点里的一句话理由也一起存
  const collect = async (it) => {
    setSaveState(s => ({ ...s, [it.url]: "saving" }))
    try {
      await apiFetch("/library/url", { method: "POST", body: { url: it.url, title: it.title, source: "hot_topic", summary: it.summary } })
      setSaveState(s => ({ ...s, [it.url]: "saved" }))
    } catch (e) {
      setSaveState(s => ({ ...s, [it.url]: e.message }))
    }
  }
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TopicGroup eyebrow="模型、产品、框架动态" title="最新消息" items={items.filter(it => kindOf(it) === "news")} saveState={saveState} onCollect={collect} onAnalyze={onAnalyze} />
          <TopicGroup eyebrow="最近一个月新建的 agent / RAG 项目" title="GitHub 新项目" items={items.filter(it => kindOf(it) === "github")} saveState={saveState} onCollect={collect} onAnalyze={onAnalyze} />
        </div>
      )}
    </div>
  )
}

// 以前存的热点没有 kind 字段，按链接判断
const kindOf = (it) => it.kind ?? (it.url?.includes("github.com") ? "github" : "news")

function TopicGroup({ eyebrow, title, items, saveState, onCollect, onAnalyze }) {
  const { colors, panelCardStyle, buttonStyle } = useTheme()
  if (items.length === 0) return null
  return (
    <div style={{ ...panelCardStyle, padding: "18px 22px 6px" }}>
      <div style={{ fontSize: 12, color: colors.textMuted }}>{eyebrow}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: colors.text, margin: "2px 0 4px" }}>{title} · {items.length}</div>
      {items.map((it, i) => {
        // 附加信息：新闻显示来源网站和发布日期，仓库显示星数
        const meta = kindOf(it) === "github"
          ? (it.stars != null ? `★ ${it.stars}` : "GitHub")
          : [it.source, it.published_date ? formatShort(it.published_date, { withTime: false }) : null].filter(Boolean).join(" · ")
        const state = saveState[it.url]
        const failed = state && state !== "saving" && state !== "saved"
        return (
          <div key={it.url || i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderBottom: i < items.length - 1 ? `1px solid ${colors.borderLight}` : "none" }}>
            <a href={it.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>{it.title}</span>
                {meta && <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>{meta}</span>}
              </div>
              {it.summary && <div style={{ fontSize: 13.5, color: colors.textSecondary, marginTop: 5, lineHeight: 1.55 }}>{it.summary}</div>}
              {failed && <div style={{ fontSize: 12, color: colors.danger, marginTop: 4 }}>收藏失败：{state}</div>}
            </a>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => onAnalyze(it)}
              title="新开一个对话，让知行读原文并结合你的情况分析"
              style={{ ...buttonStyle, padding: "4px 10px", fontSize: 12.5, color: colors.ink, cursor: "pointer" }}
            >
              问知行
            </button>
            <button
              onClick={() => onCollect(it)}
              disabled={state === "saving" || state === "saved"}
              title={state === "saved" ? "已在资料库里" : "收藏进资料库，知行以后能检索到"}
              style={{
                ...buttonStyle, padding: "4px 10px", fontSize: 12.5, flexShrink: 0,
                color: state === "saved" ? colors.ink : colors.textSecondary,
                cursor: state === "saving" ? "wait" : state === "saved" ? "default" : "pointer",
              }}
            >
              {state === "saving" ? "收藏中…" : state === "saved" ? "已收藏" : "收藏"}
            </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default HotTopicsPanel
