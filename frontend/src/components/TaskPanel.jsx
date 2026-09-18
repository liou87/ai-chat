import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents } from "../theme"

// 任务面板：既可以让用户直接在界面上增删改任务，
// 也会在 agent 通过工具改动任务后（refreshKey 变化）自动刷新，
// 保证"聊天里说的"和"面板上看到的"始终一致。
// mode="compact" 用在总览网格的卡片里；mode="expanded" 用在图标栏点开的单模块全页视图，按完成状态分组、行更宽松。
function TaskPanel({ refreshKey, accent = moduleAccents.tasks, mode = "compact" }) {
  const { colors, inputStyle, accentButtonStyle, iconButtonStyle } = useTheme()
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

  const pending = tasks.filter(t => !t.done).sort((a, b) => {
    if (!a.due_at) return 1
    if (!b.due_at) return -1
    return new Date(a.due_at) - new Date(b.due_at)
  })
  const done = tasks.filter(t => t.done)
  const expanded = mode === "expanded"

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: expanded ? 20 : 12 }}>
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTask()}
          placeholder="新任务..."
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={addTask} style={accentButtonStyle(accent)}>+</button>
      </div>

      {!loading && tasks.length > 0 && !expanded && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
          {pending.length} 条未完成 / 共 {tasks.length} 条
        </div>
      )}
      {loading && tasks.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && tasks.length === 0 && <div style={{ color: colors.textMuted }}>暂无任务</div>}

      {expanded ? (
        <>
          {pending.length > 0 && (
            <>
              <SectionLabel colors={colors}>未完成 · {pending.length}</SectionLabel>
              {pending.map(t => (
                <TaskRow key={t.id} t={t} accent={accent} colors={colors} iconButtonStyle={iconButtonStyle} expanded onComplete={completeTask} onDelete={deleteTask} />
              ))}
            </>
          )}
          {done.length > 0 && (
            <>
              <SectionLabel colors={colors}>已完成 · {done.length}</SectionLabel>
              {done.map(t => (
                <TaskRow key={t.id} t={t} accent={accent} colors={colors} iconButtonStyle={iconButtonStyle} expanded onComplete={completeTask} onDelete={deleteTask} />
              ))}
            </>
          )}
        </>
      ) : (
        tasks.map(t => (
          <TaskRow key={t.id} t={t} accent={accent} colors={colors} iconButtonStyle={iconButtonStyle} onComplete={completeTask} onDelete={deleteTask} />
        ))
      )}
    </div>
  )
}

function SectionLabel({ children, colors }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, margin: "16px 0 8px" }}>{children}</div>
}

function TaskRow({ t, accent, colors, iconButtonStyle, expanded, onComplete, onDelete }) {
  const border = `1px solid ${colors.borderLight}`
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: expanded ? "12px 14px" : "8px 0",
        marginBottom: expanded ? 8 : 0,
        borderRadius: expanded ? 10 : 0,
        border: expanded ? border : "none",
        borderBottom: expanded ? border : border,
      }}
    >
      <input
        type="checkbox"
        checked={t.done}
        onChange={() => !t.done && onComplete(t.id)}
        disabled={t.done}
        style={{ accentColor: accent }}
      />
      <span style={{
        flex: 1,
        textDecoration: t.done ? "line-through" : "none",
        color: t.done ? colors.textMuted : colors.text,
        fontSize: expanded ? 15 : 14,
      }}>
        {t.title}
        {t.due_at && (
          <div style={{ fontSize: 11, color: colors.textMuted }}>
            截止：{new Date(t.due_at).toLocaleString()}
          </div>
        )}
      </span>
      <button onClick={() => onDelete(t.id)} style={iconButtonStyle} title="删除">×</button>
    </div>
  )
}

export default TaskPanel
