import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"

// 笔记面板：既能浏览/新增/删除笔记，也能直接在这里测试语义检索
// （输入框有内容时走 /notes/search，展示相似度分数，方便直观看到 RAG 效果）
function NotePanel({ refreshKey }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [showForm, setShowForm] = useState(false)

  const fetchNotes = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/notes`, { headers: authHeaders })
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
      const res = await fetch(url, { headers: authHeaders })
      setNotes(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (searchQuery.trim()) {
      runSearch(searchQuery.trim())
    } else {
      fetchNotes()
    }
  }, [refreshKey])

  const handleSearchSubmit = () => {
    if (searchQuery.trim()) {
      runSearch(searchQuery.trim())
    } else {
      fetchNotes()
    }
  }

  const addNote = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    await fetch(`${API}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ title: newTitle, content: newContent })
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
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>笔记</h3>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearchSubmit()}
          placeholder="语义搜索笔记..."
          style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
        />
        <button onClick={handleSearchSubmit} style={{ padding: "6px 10px", borderRadius: 6 }}>搜</button>
      </div>

      {!showForm ? (
        <button onClick={() => setShowForm(true)} style={{ marginBottom: 12, padding: "6px 8px", borderRadius: 6 }}>
          + 新建笔记
        </button>
      ) : (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="标题"
            style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
          />
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
      {!loading && notes.length === 0 && <div style={{ color: "#999" }}>暂无笔记</div>}

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
