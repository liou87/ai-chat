import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"

// 笔记 / 日记复盘面板：两个 tab 共用同一套笔记数据（category 区分），
// 搜索框走语义检索并展示相似度分数，日记 tab 下额外提供"生成本周复盘"入口。
function NotePanel({ refreshKey, onRequestWeeklyReview }) {
  const [category, setCategory] = useState("note")  // note | journal
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
    refresh()
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
    <div style={{ width: 300, borderLeft: "1px solid #ddd", padding: 16, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {[["note", "笔记"], ["journal", "日记"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setCategory(key); setSearchQuery(""); setShowForm(false) }}
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: category === key ? "#0084ff" : "white",
              color: category === key ? "white" : "black",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {category === "journal" && (
        <button
          onClick={onRequestWeeklyReview}
          style={{ marginBottom: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid #0084ff", color: "#0084ff", background: "white" }}
        >
          生成本周复盘
        </button>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && refresh()}
          placeholder={category === "journal" ? "语义搜索日记..." : "语义搜索笔记..."}
          style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
        />
        <button onClick={refresh} style={{ padding: "6px 10px", borderRadius: 6 }}>搜</button>
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} style={{ marginBottom: 12, padding: "6px 8px", borderRadius: 6 }}>
          + {category === "journal" ? "写今天的日记" : "新建笔记"}
        </button>
      ) : (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {category === "note" && (
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="标题"
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
            />
          )}
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="正文"
            rows={3}
            style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={addNote} style={{ flex: 1, padding: "6px 8px", borderRadius: 6 }}>保存</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "6px 8px", borderRadius: 6 }}>取消</button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: "#999" }}>加载中...</div>}
      {!loading && notes.length === 0 && <div style={{ color: "#999" }}>暂无内容</div>}

      {notes.map(n => (
        <div key={n.id} style={{ padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>{n.title}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {n.score !== undefined && (
                <span style={{ fontSize: 11, color: "#0084ff" }}>{n.score.toFixed(2)}</span>
              )}
              <button
                onClick={() => deleteNote(n.id)}
                style={{ border: "none", background: "none", color: "#c00", cursor: "pointer" }}
                title="删除"
              >
                ×
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4, whiteSpace: "pre-wrap" }}>
            {n.content}
          </div>
        </div>
      ))}
    </div>
  )
}

export default NotePanel
