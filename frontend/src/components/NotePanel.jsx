import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents } from "../theme"

// 笔记 / 日记复盘共用的内容面板，category 由外层容器决定，accent 决定这张卡片的强调色。
// 搜索框走语义检索并展示相似度分数，journal 分类下额外提供"生成本周复盘"入口。
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
        <button onClick={() => setShowForm(true)} style={{ ...accentButtonStyle(resolvedAccent), width: "100%", marginBottom: 12 }}>
          + {category === "journal" ? "写今天的日记" : "新建笔记"}
        </button>
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
            <strong style={{ fontSize: expanded ? 15.5 : 14, color: colors.text }}>{n.title}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {n.score !== undefined && (
                <span style={{ fontSize: 11, color: resolvedAccent }}>{n.score.toFixed(2)}</span>
              )}
              <button onClick={() => deleteNote(n.id)} style={iconButtonStyle} title="删除">×</button>
            </div>
          </div>
          <div style={{ fontSize: expanded ? 13 : 12, color: colors.textSecondary, marginTop: 4, whiteSpace: "pre-wrap" }}>
            {n.content}
          </div>
        </div>
      ))}
    </div>
  )
}

export default NotePanel
