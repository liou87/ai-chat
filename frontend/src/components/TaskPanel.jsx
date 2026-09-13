import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"
import { colors, inputStyle, primaryButtonStyle, iconButtonStyle } from "../theme"

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

  const pendingCount = tasks.filter(t => !t.done).length

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTask()}
          placeholder="新任务..."
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={addTask} style={primaryButtonStyle}>+</button>
      </div>

      {!loading && tasks.length > 0 && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
          {pendingCount} 条未完成 / 共 {tasks.length} 条
        </div>
      )}
      {loading && tasks.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && tasks.length === 0 && <div style={{ color: colors.textMuted }}>暂无任务</div>}

      {tasks.map(t => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 0",
            borderBottom: `1px solid ${colors.borderLight}`,
          }}
        >
          <input type="checkbox" checked={t.done} onChange={() => !t.done && completeTask(t.id)} disabled={t.done} />
          <span style={{
            flex: 1,
            textDecoration: t.done ? "line-through" : "none",
            color: t.done ? colors.textMuted : "#000",
            fontSize: 14,
          }}>
            {t.title}
            {t.due_at && (
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                截止：{new Date(t.due_at).toLocaleString()}
              </div>
            )}
          </span>
          <button onClick={() => deleteTask(t.id)} style={iconButtonStyle} title="删除">×</button>
        </div>
      ))}
    </div>
  )
}

export default TaskPanel
