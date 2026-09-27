import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { moduleAccents, formMaxWidth, disabledStyle } from "../theme"
import { ModuleIcon } from "../icons"
import { isSubmitEnter } from "../keyboard"
import { toInputValue, formatShort } from "../datetime"
import LoadError from "./LoadError"

const TIER_LABEL = { phase: "阶段", month: "月", week: "周" }

// 未完成按截止时间排，没截止时间的排后面
const byDue = (a, b) => {
  if (!a.due_at) return 1
  if (!b.due_at) return -1
  return new Date(a.due_at) - new Date(b.due_at)
}

// 任务面板：既可以让用户直接在界面上增删改任务，
// 也会在 agent 通过工具改动任务后（refreshKey 变化）自动刷新，
// 保证"聊天里说的"和"面板上看到的"始终一致。
// 点任务行在下方展开编辑区（标题 / 截止时间 / 挂靠目标），同一时间只展开一条。
// mode="compact" 用在总览卡片里，已完成的默认折叠；mode="expanded" 用在单模块全页视图，行更宽松。
function TaskPanel({ refreshKey, accent = moduleAccents.tasks, mode = "compact" }) {
  const { colors, inputStyle, accentButtonStyle } = useTheme()
  const confirm = useConfirm()
  const [tasks, setTasks] = useState([])
  const [goals, setGoals] = useState([])
  const [newTitle, setNewTitle] = useState("")
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)          // 列表加载失败
  const [actionError, setActionError] = useState(null)  // 新建/修改/删除失败
  const [editingId, setEditingId] = useState(null)
  const [showDone, setShowDone] = useState(mode === "expanded")

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const [taskList, goalList] = await Promise.all([apiFetch("/tasks"), apiFetch("/goals")])
      setTasks(taskList)
      setGoals(goalList)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
  }, [refreshKey])

  // 增删改统一走这里：失败时在列表上方提示，成功后重新拉列表
  const mutate = async (request) => {
    try {
      await request()
      setActionError(null)
      return true
    } catch (e) {
      setActionError(e.message)
      return false
    } finally {
      fetchTasks()
    }
  }

  const canAdd = newTitle.trim() !== "" && !adding

  // 失败时把输入还回去，免得刚打的字丢了
  const addTask = async () => {
    if (!canAdd) return
    const title = newTitle.trim()
    setNewTitle("")
    setAdding(true)
    const ok = await mutate(() => apiFetch("/tasks", { method: "POST", body: { title } }))
    setAdding(false)
    if (!ok) setNewTitle(title)
  }

  const toggleDone = (t) => mutate(() => apiFetch(`/tasks/${t.id}`, { method: "PATCH", body: { done: !t.done } }))

  const saveTask = async (id, changes) => {
    if (await mutate(() => apiFetch(`/tasks/${id}`, { method: "PATCH", body: changes }))) setEditingId(null)
  }

  const deleteTask = async (t) => {
    if (!(await confirm({ title: "删除任务", message: `「${t.title}」删除后无法恢复。` }))) return
    if (editingId === t.id) setEditingId(null)
    await mutate(() => apiFetch(`/tasks/${t.id}`, { method: "DELETE" }))
  }

  const pending = tasks.filter(t => !t.done).sort(byDue)
  const done = tasks.filter(t => t.done)
  const expanded = mode === "expanded"
  const goalTitles = Object.fromEntries(goals.map(g => [g.id, g.title]))

  const renderRow = (t) => (
    <TaskRow
      key={t.id}
      t={t}
      accent={accent}
      goals={goals}
      goalTitle={goalTitles[t.goal_id]}
      expanded={expanded}
      editing={editingId === t.id}
      onToggleEdit={() => setEditingId(id => id === t.id ? null : t.id)}
      onToggleDone={() => toggleDone(t)}
      onSave={changes => saveTask(t.id, changes)}
      onDelete={() => deleteTask(t)}
    />
  )

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: expanded ? 20 : 12, maxWidth: formMaxWidth }}>
        <input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => isSubmitEnter(e) && addTask()}
          placeholder="新任务..."
          aria-label="新任务"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={addTask}
          disabled={!canAdd}
          title={adding ? "添加中..." : !newTitle.trim() ? "先输入任务内容" : "添加任务"}
          aria-label="添加任务"
          style={{ ...accentButtonStyle(accent), ...(!canAdd ? disabledStyle : {}) }}
        >
          {adding ? "…" : "+"}
        </button>
      </div>

      {actionError && <div style={{ marginBottom: 8 }}><LoadError message={actionError} /></div>}
      {loading && tasks.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {error && <LoadError message={error} onRetry={fetchTasks} />}
      {!loading && !error && tasks.length === 0 && <div style={{ color: colors.textMuted }}>暂无任务</div>}

      {pending.length > 0 && (
        <>
          <SectionLabel colors={colors} first>未完成 · {pending.length}</SectionLabel>
          {pending.map(renderRow)}
        </>
      )}
      {done.length > 0 && (
        <>
          <button
            onClick={() => setShowDone(s => !s)}
            aria-expanded={showDone}
            style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: colors.textMuted, margin: "16px 0 8px", fontFamily: "inherit" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: showDone ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
            已完成 · {done.length}
          </button>
          {showDone && done.map(renderRow)}
        </>
      )}
    </div>
  )
}

function SectionLabel({ children, colors, first }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, margin: first ? "4px 0 8px" : "16px 0 8px" }}>{children}</div>
}

function TaskRow({ t, accent, goals, goalTitle, expanded, editing, onToggleEdit, onToggleDone, onSave, onDelete }) {
  const { colors, iconButtonStyle } = useTheme()
  const border = `1px solid ${colors.borderLight}`
  const overdue = !t.done && t.due_at && new Date(t.due_at) < new Date()
  return (
    <div
      style={{
        padding: expanded ? "12px 14px" : "8px 0",
        marginBottom: expanded ? 8 : 0,
        borderRadius: expanded ? 10 : 0,
        border: expanded ? border : "none",
        borderBottom: border,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={t.done}
          onChange={onToggleDone}
          style={{ accentColor: accent, cursor: "pointer" }}
          aria-label={t.done ? `标记为未完成：${t.title}` : `完成：${t.title}`}
        />
        <button
          onClick={onToggleEdit}
          aria-expanded={editing}
          title="点击编辑"
          style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}
        >
          <div style={{
            textDecoration: t.done ? "line-through" : "none",
            color: t.done ? colors.textMuted : colors.text,
            fontSize: expanded ? 15 : 14,
          }}>
            {t.title}
          </div>
          {goalTitle && (
            <div style={{ fontSize: 11, color: moduleAccents.goals, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
              <ModuleIcon name="goals" color="currentColor" size={11} />
              {goalTitle}
            </div>
          )}
          {t.due_at && (
            <div style={{ fontSize: 11, color: overdue ? colors.danger : colors.textMuted, marginTop: 2 }}>
              截止：{formatShort(t.due_at)}{overdue && "（已过期）"}
            </div>
          )}
        </button>
        <button onClick={onDelete} style={iconButtonStyle} title="删除" aria-label={`删除：${t.title}`}>×</button>
      </div>
      {editing && <TaskEditor t={t} goals={goals} accent={accent} onSave={onSave} onCancel={onToggleEdit} />}
    </div>
  )
}

// 任务的编辑区：标题、截止时间（可清空）、挂靠目标（可不挂）
function TaskEditor({ t, goals, accent, onSave, onCancel }) {
  const { colors, inputStyle, buttonStyle, accentButtonStyle } = useTheme()
  const [title, setTitle] = useState(t.title)
  const [dueAt, setDueAt] = useState(toInputValue(t.due_at))
  const [goalId, setGoalId] = useState(t.goal_id ?? "")

  const save = () => {
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      due_at: dueAt || null,
      goal_id: goalId === "" ? null : Number(goalId),
    })
  }

  const labelStyle = { fontSize: 12, color: colors.textMuted, width: 36, flexShrink: 0 }
  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: colors.surface, border: `1px solid ${colors.borderLight}`, display: "flex", flexDirection: "column", gap: 8, maxWidth: formMaxWidth }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={labelStyle}>标题</span>
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => isSubmitEnter(e) && save()} style={{ ...inputStyle, flex: 1, minWidth: 0 }} autoFocus />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={labelStyle}>截止</span>
        <input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        {dueAt && (
          <button onClick={() => setDueAt("")} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, color: colors.textMuted, padding: 0 }}>清除</button>
        )}
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={labelStyle}>目标</span>
        <select value={goalId} onChange={e => setGoalId(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }}>
          <option value="">不挂靠目标</option>
          {goals.map(g => <option key={g.id} value={g.id}>{TIER_LABEL[g.tier]}目标：{g.title}</option>)}
        </select>
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
        <button onClick={onCancel} style={buttonStyle}>取消</button>
        <button
          onClick={save}
          disabled={!title.trim()}
          title={!title.trim() ? "标题不能为空" : undefined}
          style={{ ...accentButtonStyle(accent), ...(!title.trim() ? disabledStyle : {}) }}
        >
          保存
        </button>
      </div>
    </div>
  )
}

export default TaskPanel
