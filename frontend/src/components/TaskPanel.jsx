import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { disabledStyle } from "../theme"
import { isSubmitEnter } from "../keyboard"
import { toInputValue, formatShort } from "../datetime"
import LoadError from "./LoadError"
import { PageHeader, Badge, Modal, Field, Segmented } from "./ui"
import { PRIORITY_OPTIONS, PRIORITY_LABEL, PRIORITY_TONE, byPriorityThenDue, formatMinutes, isOverdue } from "../taskMeta"

const TIER_LABEL = { phase: "阶段", month: "月", week: "周" }
// 任务面板：既可以让用户直接在界面上增删改任务，
// 也会在 agent 通过工具改动任务后（refreshKey 变化）自动刷新，
// 保证"聊天里说的"和"面板上看到的"始终一致。
// 单模块全页视图（参考图风格）：标题区 + 统计格 + 白卡片列表，新增和编辑都走弹窗。
// 总览页的"关键任务"卡片是 WorkbenchPanel 自己画的，只复用这里导出的 TaskFormModal。
function TaskPanel({ refreshKey }) {
  const { colors, darkButtonStyle, panelCardStyle } = useTheme()
  const confirm = useConfirm()
  const [tasks, setTasks] = useState([])
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)          // 列表加载失败
  const [actionError, setActionError] = useState(null)  // 新建/修改/删除失败
  const [editing, setEditing] = useState(null)      // null | "new" | 任务对象
  const [showDone, setShowDone] = useState(false)

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

  // 打勾先改界面再发请求（请求加刷新要一两秒，不先改看起来像没反应）；失败时 mutate 重新拉列表会恢复原状
  const toggleDone = (t) => {
    setTasks(list => list.map(x => x.id === t.id ? { ...x, done: !t.done, updated_at: new Date().toISOString() } : x))
    return mutate(() => apiFetch(`/tasks/${t.id}`, { method: "PATCH", body: { done: !t.done } }))
  }

  // 弹窗保存：新建走 POST，编辑走 PATCH；成功才关弹窗，失败保留填的内容
  const submitForm = async (values) => {
    const ok = editing === "new"
      ? await mutate(() => apiFetch("/tasks", { method: "POST", body: values }))
      : await mutate(() => apiFetch(`/tasks/${editing.id}`, { method: "PATCH", body: values }))
    if (ok) setEditing(null)
    return ok
  }

  const deleteTask = async (t) => {
    if (!(await confirm({ title: "删除任务", message: `「${t.title}」删除后无法恢复。` }))) return
    if (await mutate(() => apiFetch(`/tasks/${t.id}`, { method: "DELETE" }))) setEditing(null)
  }

  const pending = tasks.filter(t => !t.done).sort(byPriorityThenDue)
  const done = tasks.filter(t => t.done)
  const goalTitles = Object.fromEntries(goals.map(g => [g.id, g.title]))

  const renderRow = (t, last) => (
    <TaskRow
      key={t.id}
      t={t}
      goalTitle={goalTitles[t.goal_id]}
      last={last}
      onOpen={() => setEditing(t)}
      onToggleDone={() => toggleDone(t)}
    />
  )

  const status = (
    <>
      {actionError && <div style={{ marginBottom: 10 }}><LoadError message={actionError} /></div>}
      {loading && tasks.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {error && <LoadError message={error} onRetry={fetchTasks} />}
    </>
  )

  const modal = editing && (
    <TaskFormModal
      task={editing === "new" ? null : editing}
      goals={goals}
      onSubmit={submitForm}
      onDelete={editing === "new" ? null : () => deleteTask(editing)}
      onClose={() => setEditing(null)}
    />
  )

  const doneToggle = done.length > 0 && (
    <button
      onClick={() => setShowDone(s => !s)}
      aria-expanded={showDone}
      style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: colors.textMuted, fontFamily: "inherit" }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: showDone ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
        <path d="M9 18l6-6-6-6" />
      </svg>
      已完成 · {done.length}
    </button>
  )

  const high = tasks.filter(t => t.priority === "high")
  const plannedMinutes = pending.reduce((sum, t) => sum + (t.estimate_minutes || 0), 0)
  const overdueCount = pending.filter(isOverdue).length
  const stats = [
    { label: "已完成", value: `${done.length} / ${tasks.length}` },
    { label: "关键任务", value: `${high.filter(t => t.done).length} / ${high.length}` },
    { label: "计划时长", value: formatMinutes(plannedMinutes) },
    { label: "已延期", value: overdueCount, warn: overdueCount > 0 },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="按优先级排序"
        title="任务"
        action={<button onClick={() => setEditing("new")} style={darkButtonStyle}>+ 新增任务</button>}
      />

      {/* 统计格：四格连成一条，格与格之间用细线分隔 */}
      <div style={{ ...panelCardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: 20, overflow: "hidden" }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{ padding: "14px 18px", borderLeft: i === 0 ? "none" : `1px solid ${colors.cardBorder}` }}>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.warn ? colors.dangerInk : colors.text, letterSpacing: -0.3 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {status}

      <div style={{ ...panelCardStyle, padding: "18px 22px 8px" }}>
        <div style={{ fontSize: 12, color: colors.textMuted }}>优先处理</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: colors.text, margin: "2px 0 6px" }}>待办事项 · {pending.length}</div>
        {!loading && !error && pending.length === 0 && (
          <div style={{ color: colors.textMuted, padding: "14px 0 18px", fontSize: 14 }}>
            {tasks.length === 0 ? "还没有任务，点右上角「新增任务」开始" : "全部完成了"}
          </div>
        )}
        {pending.map((t, i) => renderRow(t, i === pending.length - 1))}
      </div>

      {done.length > 0 && (
        <div style={{ ...panelCardStyle, padding: "14px 22px", marginTop: 16 }}>
          {doneToggle}
          {showDone && <div style={{ marginTop: 6 }}>{done.map((t, i) => renderRow(t, i === done.length - 1))}</div>}
        </div>
      )}
      {modal}
    </div>
  )
}

function TaskRow({ t, goalTitle, last, onOpen, onToggleDone }) {
  const { colors } = useTheme()
  const overdue = isOverdue(t)
  // 附加信息：所属目标 · 预计时长 · 截止时间，有什么显示什么
  const meta = [
    goalTitle,
    t.estimate_minutes ? `${t.estimate_minutes} 分钟` : null,
    t.due_at ? `截止 ${formatShort(t.due_at)}${overdue ? "（已延期）" : ""}` : null,
  ].filter(Boolean)

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: last ? "none" : `1px solid ${colors.borderLight}` }}>
      <input
        type="checkbox"
        checked={t.done}
        onChange={onToggleDone}
        style={{ accentColor: colors.ink, cursor: "pointer", width: 18, height: 18, flexShrink: 0 }}
        aria-label={t.done ? `标记为未完成：${t.title}` : `完成：${t.title}`}
      />
      <button
        onClick={onOpen}
        title="点击编辑"
        style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}
      >
        <div style={{
          fontSize: 15,
          fontWeight: 600,
          color: t.done ? colors.textMuted : colors.text,
          textDecoration: t.done ? "line-through" : "none",
        }}>
          {t.title}
        </div>
        {meta.length > 0 && (
          <div style={{ fontSize: 12, color: overdue ? colors.dangerInk : colors.textMuted, marginTop: 3 }}>
            {meta.join(" · ")}
          </div>
        )}
      </button>
      {!t.done && <Badge tone={PRIORITY_TONE[t.priority] ?? "neutral"}>{PRIORITY_LABEL[t.priority] ?? "中"}</Badge>}
    </div>
  )
}

// 新增/编辑任务的弹窗：标题、优先级、预计时长、截止时间、挂靠目标；编辑时左下角有删除
export function TaskFormModal({ task, goals, onSubmit, onDelete, onClose }) {
  const { inputStyle, buttonStyle, darkButtonStyle, colors } = useTheme()
  const [title, setTitle] = useState(task?.title ?? "")
  const [priority, setPriority] = useState(task?.priority ?? "medium")
  const [minutes, setMinutes] = useState(task?.estimate_minutes ? String(task.estimate_minutes) : "")
  const [dueAt, setDueAt] = useState(toInputValue(task?.due_at))
  const [goalId, setGoalId] = useState(task?.goal_id ?? "")
  const [saving, setSaving] = useState(false)

  const canSave = title.trim() !== "" && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    await onSubmit({
      title: title.trim(),
      priority,
      estimate_minutes: minutes ? Number(minutes) : null,
      due_at: dueAt || null,
      goal_id: goalId === "" ? null : Number(goalId),
    })
    setSaving(false)
  }

  return (
    <Modal
      title={task ? "编辑任务" : "新增任务"}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button onClick={onDelete} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 13, color: colors.danger }}>删除任务</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={buttonStyle}>取消</button>
          <button onClick={save} disabled={!canSave} title={!title.trim() ? "先填任务内容" : undefined} style={{ ...darkButtonStyle, ...(!canSave ? disabledStyle : {}) }}>
            {saving ? "保存中..." : "保存"}
          </button>
        </>
      }
    >
      <Field label="任务内容">
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => isSubmitEnter(e) && save()} placeholder="比如：完成 CET-6 阅读真题一套" style={inputStyle} />
      </Field>
      <Field label="优先级" group>
        <Segmented value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="预计时长（分钟）">
            <input type="number" min={1} step={5} value={minutes} onChange={e => setMinutes(e.target.value.replace(/[^\d]/g, ""))} placeholder="可选" style={inputStyle} />
          </Field>
        </div>
        <div style={{ flex: 1.4 }}>
          <Field label="截止时间">
            <input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </div>
      <Field label="所属目标">
        <select value={goalId} onChange={e => setGoalId(e.target.value)} style={inputStyle}>
          <option value="">不挂靠目标</option>
          {goals.map(g => <option key={g.id} value={g.id}>{TIER_LABEL[g.tier]}目标：{g.title}</option>)}
        </select>
      </Field>
    </Modal>
  )
}

export default TaskPanel
