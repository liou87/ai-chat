import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"

// 任务面板：既可以让用户直接在界面上增删改任务，
// 也会在 agent 通过工具改动任务后（refreshKey 变化）自动刷新，
// 保证"聊天里说的"和"面板上看到的"始终一致。
function TaskPanel({ refreshKey }) {
  const [tasks, setTasks] = useState([])
  const [newTitle, setNewTitle] = useState("")
  const [loading, setLoading] = useState(false)

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/tasks`, { headers: authHeaders })
      const data = await res.json()
      setTasks(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
  }, [refreshKey])

  const addTask = async () => {
    if (!newTitle.trim()) return
    await fetch(`${API}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ title: newTitle })
    })
    setNewTitle("")
    fetchTasks()
  }

  const completeTask = async (id) => {
    await fetch(`${API}/tasks/${id}/complete`, { method: "PATCH", headers: authHeaders })
    fetchTasks()
  }

  const deleteTask = async (id) => {
    await fetch(`${API}/tasks/${id}`, { method: "DELETE", headers: authHeaders })
    fetchTasks()
  }

  return (
    <div style={{ width: 280, borderLeft: "1px solid #ddd", padding: 16, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>任务</h3>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTask()}
          placeholder="新任务..."
          style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
        />
        <button onClick={addTask} style={{ padding: "6px 10px", borderRadius: 6 }}>+</button>
      </div>

      {loading && tasks.length === 0 && <div style={{ color: "#999" }}>加载中...</div>}
      {!loading && tasks.length === 0 && <div style={{ color: "#999" }}>暂无任务</div>}

      {tasks.map(t => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 0",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <input type="checkbox" checked={t.done} onChange={() => !t.done && completeTask(t.id)} disabled={t.done} />
          <span style={{
            flex: 1,
            textDecoration: t.done ? "line-through" : "none",
            color: t.done ? "#999" : "#000",
            fontSize: 14,
          }}>
            {t.title}
            {t.due_at && (
              <div style={{ fontSize: 11, color: "#999" }}>
                截止：{new Date(t.due_at).toLocaleString()}
              </div>
            )}
          </span>
          <button
            onClick={() => deleteTask(t.id)}
            style={{ border: "none", background: "none", color: "#c00", cursor: "pointer" }}
            title="删除"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default TaskPanel
