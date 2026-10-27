import { useState, useEffect, useRef } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { disabledStyle } from "../theme"
import { isSubmitEnter } from "../keyboard"
import { toInputValue, formatShort } from "../datetime"
import LoadError from "./LoadError"
import { PageHeader, Badge, Modal, Field, Segmented } from "./ui"
import { Checkbox, DateTimeInput, Select } from "./controls"
import { useElementWidth } from "../hooks"
import { PRIORITY_OPTIONS, PRIORITY_LABEL, PRIORITY_TONE, byPriorityThenDue, formatMinutes, isOverdue } from "../taskMeta"

const TIER_LABEL = { phase: "阶段", month: "月", week: "周" }
// 列表卡片宽于这个值时，任务行拆成表格列（任务 | 目标 | 计划开始 | 预计 | 截止 | 优先级），宽度用来放信息，
// 不会出现标题在最左、优先级标签在最右、中间空一大段的情况；窄的时候退回标题 + 一行附加信息
const TABLE_AT = 720
const TABLE_COLUMNS = "24px minmax(0, 2.2fr) minmax(0, 1.3fr) 108px 64px 150px 40px"
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
  const listRef = useRef(null)
  const table = useElementWidth(listRef) >= TABLE_AT

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
      table={table}
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

      <div ref={listRef} style={{ ...panelCardStyle, padding: "18px 22px 8px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 4 }}>待办事项 · {pending.length}</div>
        {!loading && !error && pending.length === 0 && (
          <div style={{ color: colors.textMuted, padding: "14px 0 18px", fontSize: 14 }}>
            {tasks.length === 0 ? "还没有任务，点右上角「新增任务」开始" : "全部完成了"}
          </div>
        )}
        {table && pending.length > 0 && <TableHeader />}
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

function TableHeader() {
  const { colors } = useTheme()
  const cell = { fontSize: 12, color: colors.textMuted }
  return (
    <div style={{ display: "grid", gridTemplateColumns: TABLE_COLUMNS, gap: 12, padding: "10px 0 8px", borderBottom: `1px solid ${colors.borderLight}` }}>
      <span />
      <span style={cell}>任务</span>
      <span style={cell}>目标</span>
      <span style={cell}>计划开始</span>
      <span style={cell}>预计</span>
      <span style={cell}>截止</span>
      <span style={cell}>优先级</span>
    </div>
  )
}

function TaskRow({ t, goalTitle, last, table, onOpen, onToggleDone }) {
  const { colors } = useTheme()
  const overdue = isOverdue(t)
  const checkbox = (
    <Checkbox checked={t.done} onChange={onToggleDone} ariaLabel={t.done ? `标记为未完成：${t.title}` : `完成：${t.title}`} />
  )
  const titleStyle = {
    fontSize: 15,
    fontWeight: 600,
    color: t.done ? colors.textMuted : colors.text,
    textDecoration: t.done ? "line-through" : "none",
  }

  if (table) {
    // 表格行：整行可点开编辑（复选框除外），每列只放一种信息，延期只把截止那一格标红
    const cell = { fontSize: 13, color: colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
    return (
      <div style={{ display: "grid", gridTemplateColumns: TABLE_COLUMNS, gap: 12, alignItems: "center", padding: "12px 0", borderBottom: last ? "none" : `1px solid ${colors.borderLight}` }}>
        {checkbox}
        <button onClick={onOpen} title="点击编辑" style={{ ...titleStyle, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.title}
        </button>
        <span style={cell} title={goalTitle}>{goalTitle ?? ""}</span>
        <span style={cell}>{t.planned_start && !t.done ? formatShort(t.planned_start) : ""}</span>
        <span style={cell}>{t.estimate_minutes ? `${t.estimate_minutes} 分钟` : ""}</span>
        <span style={{ ...cell, color: overdue ? colors.dangerInk : cell.color }} title={overdue ? "已延期" : undefined}>
          {t.due_at ? `${formatShort(t.due_at)}${overdue ? " 延期" : ""}` : ""}
        </span>
        <span>{!t.done && <Badge tone={PRIORITY_TONE[t.priority] ?? "neutral"}>{PRIORITY_LABEL[t.priority] ?? "中"}</Badge>}</span>
      </div>
    )
  }

  // 附加信息：所属目标 · 计划开始 · 预计时长 · 截止时间，有什么显示什么
  const meta = [
    goalTitle,
    t.planned_start && !t.done ? `计划 ${formatShort(t.planned_start)}` : null,
    t.estimate_minutes ? `${t.estimate_minutes} 分钟` : null,
    t.due_at ? `截止 ${formatShort(t.due_at)}${overdue ? "（已延期）" : ""}` : null,
  ].filter(Boolean)

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: last ? "none" : `1px solid ${colors.borderLight}` }}>
      {checkbox}
      <button
        onClick={onOpen}
        title="点击编辑"
        style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}
      >
        <div style={titleStyle}>{t.title}</div>
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

// 新增/编辑任务的弹窗：标题、优先级、预计时长、计划开始、截止时间、挂靠目标；编辑时左下角有删除
export function TaskFormModal({ task, goals, onSubmit, onDelete, onClose }) {
  const { inputStyle, buttonStyle, darkButtonStyle, colors } = useTheme()
  const [title, setTitle] = useState(task?.title ?? "")
  const [priority, setPriority] = useState(task?.priority ?? "medium")
  const [minutes, setMinutes] = useState(task?.estimate_minutes ? String(task.estimate_minutes) : "")
  const [dueAt, setDueAt] = useState(toInputValue(task?.due_at))
  const [plannedStart, setPlannedStart] = useState(toInputValue(task?.planned_start))
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
      planned_start: plannedStart || null,
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
          <Field label="计划开始">
            <DateTimeInput value={plannedStart} onChange={setPlannedStart} placeholder="可选" ariaLabel="计划开始" />
          </Field>
        </div>
      </div>
      <Field label="截止时间" hint="计划开始 + 预计时长会在总览的「今日安排」里显示成时间块">
        <DateTimeInput value={dueAt} onChange={setDueAt} placeholder="可选" ariaLabel="截止时间" defaultTime="18:00" />
      </Field>
      <Field label="所属目标">
        <Select
          value={goalId}
          onChange={setGoalId}
          ariaLabel="所属目标"
          options={[{ value: "", label: "不挂靠目标" }, ...goals.map(g => ({ value: String(g.id), label: `${TIER_LABEL[g.tier]}目标：${g.title}` }))]}
        />
      </Field>
    </Modal>
  )
}

export default TaskPanel
