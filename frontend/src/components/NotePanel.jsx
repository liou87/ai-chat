import { useState, useEffect, useLayoutEffect, useRef } from "react"
import { API, authHeaders } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents, radiusSm } from "../theme"

// 笔记正文默认只显示前几行，超出才出现"展开"，避免一条长笔记（比如 Notion 长页面）占满整个列表。
// 是否溢出靠实际测量（scrollHeight 大于 clientHeight），不靠字数估算，聊天面板收起、窗口变宽时会重新测。
function NoteContent({ text, lines, fontSize }) {
  const { colors } = useTheme()
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      if (!open) setOverflows(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, lines, open])

  const clamp = open ? {} : {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div ref={ref} style={{ fontSize, color: colors.textSecondary, whiteSpace: "pre-wrap", ...clamp }}>
        {text}
      </div>
      {overflows && (
        <button
          onClick={() => setOpen(!open)}
          style={{ border: "none", background: "none", cursor: "pointer", padding: 0, marginTop: 4, fontSize: 12, color: colors.textSecondary }}
        >
          {open ? "收起" : "展开"}
        </button>
      )}
    </div>
  )
}

// 笔记 / 日记复盘共用的内容面板，category 由外层容器决定，accent 决定这张卡片的强调色。
// 搜索框走语义检索并展示相似度分数，journal 分类下额外提供"生成本周复盘"入口，
// note 分类下提供"同步 Notion"（只读导入）；Notion 来源的笔记标出来源，且不能在这里删除。
// mode="expanded" 用于图标栏点开的单模块全页视图：每条笔记独立卡片、字号更大。
function NotePanel({ refreshKey, category, onRequestWeeklyReview, accent, mode = "compact" }) {
  const { colors, inputStyle, buttonStyle, accentButtonStyle, iconButtonStyle } = useTheme()
  const expanded = mode === "expanded"
  const resolvedAccent = accent ?? (category === "journal" ? moduleAccents.journal : moduleAccents.notes)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)   // { text, isError }

  const fetchNotes = async () => {
    setLoading(true)
    try {
      const url = new URL(`${API}/notes`)
      url.searchParams.set("category", category)
      const res = await fetch(url, { headers: authHeaders })
      setNotes(await res.json())
    } finally {
      setLoading(false)
    }
  }

  const runSearch = async (query) => {
    setLoading(true)
    try {
      const url = new URL(`${API}/notes/search`)
      url.searchParams.set("query", query)
      url.searchParams.set("category", category)
      const res = await fetch(url, { headers: authHeaders })
      setNotes(await res.json())
    } finally {
      setLoading(false)
    }
  }

  const refresh = () => {
    if (searchQuery.trim()) {
      runSearch(searchQuery.trim())
    } else {
      fetchNotes()
    }
  }

  useEffect(() => {
    setSearchQuery("")
    setShowForm(false)
    setSyncStatus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, category])

  const addNote = async () => {
    if (!newContent.trim()) return
    const title = category === "journal"
      ? `日记 ${new Date().toISOString().slice(0, 10)}`
      : newTitle
    if (!title.trim()) return
    await fetch(`${API}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ title, content: newContent, category })
    })
    setNewTitle("")
    setNewContent("")
    setShowForm(false)
    fetchNotes()
  }

  const deleteNote = async (id) => {
    await fetch(`${API}/notes/${id}`, { method: "DELETE", headers: authHeaders })
    fetchNotes()
  }

  const syncNotion = async () => {
    setSyncing(true)
    setSyncStatus(null)
    try {
      const res = await fetch(`${API}/notes/sync-notion`, { method: "POST", headers: authHeaders })
      const data = await res.json()
      if (!res.ok) {
        setSyncStatus({ text: data.detail || "同步失败", isError: true })
        return
      }
      const parts = [`新增 ${data.imported}`, `更新 ${data.updated}`, `跳过 ${data.skipped}`]
      if (data.deleted > 0) parts.push(`删除 ${data.deleted}`)
      if (data.failed > 0) parts.push(`失败 ${data.failed}`)
      setSyncStatus({ text: parts.join(" · "), isError: data.failed > 0 })
      refresh()
    } catch {
      setSyncStatus({ text: "同步失败，请检查网络后再试", isError: true })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      {category === "journal" && (
        <button onClick={onRequestWeeklyReview} style={{ ...accentButtonStyle(resolvedAccent), width: "100%", marginBottom: 12 }}>
          生成本周复盘
        </button>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && refresh()}
          placeholder={category === "journal" ? "语义搜索日记..." : "语义搜索笔记..."}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={refresh} style={buttonStyle}>搜</button>
      </div>

      {!showForm ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowForm(true)} style={{ ...accentButtonStyle(resolvedAccent), flex: 1 }}>
              + {category === "journal" ? "写今天的日记" : "新建笔记"}
            </button>
            {category === "note" && (
              <button
                onClick={syncNotion}
                disabled={syncing}
                style={{ ...buttonStyle, cursor: syncing ? "wait" : "pointer", opacity: syncing ? 0.6 : 1 }}
              >
                {syncing ? "同步中..." : "同步 Notion"}
              </button>
            )}
          </div>
          {syncStatus && (
            <div style={{ fontSize: 12, marginTop: 6, color: syncStatus.isError ? colors.danger : colors.textMuted }}>
              {syncStatus.text}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {category === "note" && (
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="标题"
              style={inputStyle}
            />
          )}
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="正文"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={addNote} style={{ ...accentButtonStyle(resolvedAccent), flex: 1 }}>保存</button>
            <button onClick={() => setShowForm(false)} style={buttonStyle}>取消</button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && notes.length === 0 && <div style={{ color: colors.textMuted }}>暂无内容</div>}

      {notes.map(n => (
        <div
          key={n.id}
          style={{
            padding: expanded ? "14px 16px" : "8px 0",
            marginBottom: expanded ? 10 : 0,
            borderRadius: expanded ? 10 : 0,
            border: expanded ? `1px solid ${colors.borderLight}` : "none",
            borderBottom: `1px solid ${colors.borderLight}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <strong style={{ fontSize: expanded ? 15.5 : 14, color: colors.text }}>{n.title}</strong>
              {n.source === "notion" && (
                <span style={{
                  fontSize: 10.5,
                  padding: "1px 6px",
                  borderRadius: radiusSm,
                  border: `1px solid ${colors.border}`,
                  color: colors.textMuted,
                  flexShrink: 0,
                }}>
                  Notion
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {n.score !== undefined && (
                <span style={{ fontSize: 11, color: resolvedAccent }}>{n.score.toFixed(2)}</span>
              )}
              {n.source !== "notion" && (
                <button onClick={() => deleteNote(n.id)} style={iconButtonStyle} title="删除">×</button>
              )}
            </div>
          </div>
          <NoteContent text={n.content} lines={expanded ? 4 : 3} fontSize={expanded ? 13 : 12} />
        </div>
      ))}
    </div>
  )
}

export default NotePanel
