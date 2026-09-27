import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { disabledStyle } from "../theme"
import { isSubmitEnter } from "../keyboard"
import LoadError from "./LoadError"
import { PageHeader, Badge, ProgressBar, Modal, Field } from "./ui"
import { daysUntil, formatShort } from "../datetime"

const TIER_LABEL = { phase: "阶段目标", month: "月目标", week: "周目标" }
const PARENT_TIER = { phase: null, month: "phase", week: "month" }
const TIER_ORDER = { phase: 0, month: 1, week: 2 }
const STATUS_SUGGESTIONS = ["正常", "轻度迟缓", "严重滞后", "已完成"]

// 状态是自由文本，按关键词给个颜色：顺利的墨绿，落后的琥珀，其它灰
function statusTone(status) {
  if (!status) return "neutral"
  if (/正常|顺利|完成|按计划/.test(status)) return "ink"
  if (/迟缓|延期|滞后|落后|风险|卡住/.test(status)) return "warn"
  return "neutral"
}

// 目标面板：三层结构（阶段/月/周），月目标、周目标的上级都是可选的。
// 单模块全页视图（参考图风格）：顶层目标排成卡片网格，子目标收在父卡片底部，
// 新增和编辑都走弹窗，编辑弹窗里可以改标题、里程碑、状态、截止日期、进度，以及删除（会连带子目标，先确认）。
// 总览页的"目标与下一里程碑"卡片是 WorkbenchPanel 自己画的。
function GoalPanel({ refreshKey }) {
  const { colors, darkButtonStyle } = useTheme()
  const confirm = useConfirm()
  const [goals, setGoals] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [editing, setEditing] = useState(null)  // null | "new" | 目标对象

  const fetchGoals = async () => {
    setLoading(true)
    try {
      // 任务用来显示每个目标挂了多少任务
      const [goalList, taskList] = await Promise.all([apiFetch("/goals"), apiFetch("/tasks")])
      setGoals(goalList)
      setTasks(taskList)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGoals()
  }, [refreshKey])

  const mutate = async (request) => {
    try {
      await request()
      setActionError(null)
      return true
    } catch (e) {
      setActionError(e.message)
      return false
    } finally {
      fetchGoals()
    }
  }

  // 顶层目标：没有上级的都算（阶段目标，以及没挂上级的月目标/周目标），按阶段、月、周排
  const roots = goals.filter(g => g.parent_id == null).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
  const byParent = (parentId) => goals.filter(g => g.parent_id === parentId)
  const tasksOf = (goalId) => tasks.filter(t => t.goal_id === goalId)
  const countDescendants = (id) => byParent(id).reduce((n, child) => n + 1 + countDescendants(child.id), 0)

  // 新建：一次 POST；编辑：标题/里程碑/状态走 PATCH /goals/{id}，进度变了再走一次 /progress
  const submitForm = async ({ progress, ...fields }) => {
    let ok
    if (editing === "new") {
      ok = await mutate(() => apiFetch("/goals", { method: "POST", body: fields }))
    } else {
      const id = editing.id
      ok = await mutate(async () => {
        await apiFetch(`/goals/${id}`, { method: "PATCH", body: { title: fields.title, description: fields.description ?? "", status: fields.status ?? "", target_date: fields.target_date } })
        if (progress !== editing.progress) await apiFetch(`/goals/${id}/progress`, { method: "PATCH", body: { progress } })
      })
    }
    if (ok) setEditing(null)
    return ok
  }

  const deleteGoal = async (goal) => {
    const children = countDescendants(goal.id)
    const linked = tasksOf(goal.id).length
    const lines = [`「${goal.title}」删除后无法恢复。`]
    if (children > 0) lines.push(`下面的 ${children} 个子目标会一起删除。`)
    if (linked > 0) lines.push(`挂在它下面的 ${linked} 个任务会保留，只是不再挂靠这个目标。`)
    if (!(await confirm({ title: `删除${TIER_LABEL[goal.tier]}`, message: lines.join("\n") }))) return
    if (await mutate(() => apiFetch(`/goals/${goal.id}`, { method: "DELETE" }))) setEditing(null)
  }

  return (
    <div>
      <PageHeader
        eyebrow="阶段目标 · 月目标 · 周目标"
        title="目标与规划"
        action={<button onClick={() => setEditing("new")} style={darkButtonStyle}>+ 新增目标</button>}
      />

      {actionError && <div style={{ marginBottom: 12 }}><LoadError message={actionError} /></div>}
      {loading && goals.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {error && <LoadError message={error} onRetry={fetchGoals} />}
      {!loading && !error && roots.length === 0 && (
        <div style={{ color: colors.textMuted, fontSize: 14 }}>还没有目标，点右上角「新增目标」开始</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
        {roots.map(g => (
          <GoalCard key={g.id} goal={g} byParent={byParent} tasksOf={tasksOf} onOpen={setEditing} />
        ))}
      </div>

      {editing && (
        <GoalFormModal
          goal={editing === "new" ? null : editing}
          goals={goals}
          onSubmit={submitForm}
          onDelete={editing === "new" ? null : () => deleteGoal(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function GoalCard({ goal, byParent, tasksOf, onOpen }) {
  const { colors, panelCardStyle } = useTheme()
  const children = byParent(goal.id)
  const linked = tasksOf(goal.id)
  const linkedDone = linked.filter(t => t.done).length

  return (
    <div style={{ ...panelCardStyle, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
      <button
        onClick={() => onOpen(goal)}
        title="点击编辑"
        style={{ textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Badge tone="ink">{TIER_LABEL[goal.tier]}</Badge>
          {goal.status && <Badge tone={statusTone(goal.status)}>{goal.status}</Badge>}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.text, letterSpacing: -0.2 }}>{goal.title}</div>
        {goal.description && (
          <div style={{ fontSize: 14, color: colors.textSecondary, marginTop: 6, lineHeight: 1.5 }}>下一里程碑：{goal.description}</div>
        )}
        {goal.target_date && <TargetDateLine date={goal.target_date} />}
        <div style={{ marginTop: 22 }}>
          <ProgressBar percent={goal.progress} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 8 }}>
            <span style={{ color: colors.textMuted }}>当前进度</span>
            <span style={{ color: colors.text, fontWeight: 600 }}>{goal.progress}%</span>
          </div>
        </div>
      </button>

      {(children.length > 0 || linked.length > 0) && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.borderLight}`, display: "flex", flexDirection: "column", gap: 2 }}>
          {children.map(child => (
            <SubGoalRow key={child.id} goal={child} depth={0} byParent={byParent} onOpen={onOpen} />
          ))}
          {linked.length > 0 && (
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: children.length ? 6 : 0 }}>
              挂靠任务 · 完成 {linkedDone}/{linked.length}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 截止日期那一行：还剩几天；过期了标红
function TargetDateLine({ date }) {
  const { colors } = useTheme()
  const days = daysUntil(date)
  const text = days > 0 ? `还有 ${days} 天` : days === 0 ? "今天截止" : `已过期 ${-days} 天`
  return (
    <div style={{ fontSize: 12.5, color: days < 0 ? colors.dangerInk : colors.textMuted, marginTop: 6 }}>
      截止 {formatShort(date, { withTime: false })} · {text}
    </div>
  )
}

// 卡片底部的子目标行：层级小字 + 标题 + 进度，周目标在月目标下面再缩进一层；点一下弹窗编辑
function SubGoalRow({ goal, depth, byParent, onOpen }) {
  const { colors } = useTheme()
  const children = byParent(goal.id)
  return (
    <>
      <button
        onClick={() => onOpen(goal)}
        title="点击编辑"
        style={{ display: "flex", alignItems: "center", gap: 8, border: "none", background: "none", padding: `5px 0 5px ${depth * 16}px`, cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
      >
        <span style={{ fontSize: 11, color: colors.textMuted, flexShrink: 0, width: 36 }}>{TIER_LABEL[goal.tier].replace("目标", "")}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal.title}</span>
        {goal.status && <Badge tone={statusTone(goal.status)}>{goal.status}</Badge>}
        <span style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600, width: 36, textAlign: "right", flexShrink: 0 }}>{goal.progress}%</span>
      </button>
      {children.map(child => <SubGoalRow key={child.id} goal={child} depth={depth + 1} byParent={byParent} onOpen={onOpen} />)}
    </>
  )
}

// 新增/编辑目标的弹窗。新增：层级、上级（可选）、标题、里程碑、状态；
// 编辑：层级和上级只显示不改（挪层级牵扯子目标），多一个进度滑块，左下角有删除
function GoalFormModal({ goal, goals, onSubmit, onDelete, onClose }) {
  const { colors, inputStyle, buttonStyle, darkButtonStyle } = useTheme()
  const [tier, setTier] = useState(goal?.tier ?? "phase")
  const [parentId, setParentId] = useState(goal?.parent_id ?? "")
  const [title, setTitle] = useState(goal?.title ?? "")
  const [description, setDescription] = useState(goal?.description ?? "")
  const [status, setStatus] = useState(goal?.status ?? "")
  const [progress, setProgress] = useState(goal?.progress ?? 0)
  const [targetDate, setTargetDate] = useState(goal?.target_date ? goal.target_date.slice(0, 10) : "")
  const [saving, setSaving] = useState(false)

  const parentTier = PARENT_TIER[tier]
  const parentOptions = goals.filter(g => g.tier === parentTier)
  const parent = goal?.parent_id ? goals.find(g => g.id === goal.parent_id) : null
  const canSave = title.trim() !== "" && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    await onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      status: status.trim() || null,
      target_date: targetDate || null,
      progress,
      ...(goal ? {} : { tier, parent_id: parentId === "" ? null : Number(parentId) }),
    })
    setSaving(false)
  }

  return (
    <Modal
      title={goal ? `编辑${TIER_LABEL[goal.tier]}` : "新增目标"}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button onClick={onDelete} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 13, color: colors.danger }}>删除目标</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={buttonStyle}>取消</button>
          <button onClick={save} disabled={!canSave} title={!title.trim() ? "先填目标标题" : undefined} style={{ ...darkButtonStyle, ...(!canSave ? disabledStyle : {}) }}>
            {saving ? "保存中..." : "保存"}
          </button>
        </>
      }
    >
      {goal ? (
        <div style={{ fontSize: 12.5, color: colors.textMuted }}>
          {TIER_LABEL[goal.tier]}{parent ? ` · 属于「${parent.title}」` : ""}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="层级">
              <select value={tier} onChange={e => { setTier(e.target.value); setParentId("") }} style={inputStyle}>
                <option value="phase">阶段目标</option>
                <option value="month">月目标</option>
                <option value="week">周目标</option>
              </select>
            </Field>
          </div>
          {parentTier && (
            <div style={{ flex: 1.4 }}>
              <Field label="上级目标" hint={parentOptions.length === 0 ? `还没有${TIER_LABEL[parentTier]}，可以先不挂` : undefined}>
                <select value={parentId} onChange={e => setParentId(e.target.value)} style={inputStyle}>
                  <option value="">不挂上级（可选）</option>
                  {parentOptions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </Field>
            </div>
          )}
        </div>
      )}
      <Field label="目标">
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => isSubmitEnter(e) && save()} placeholder="比如：CET-6 达到 500 分" style={inputStyle} />
      </Field>
      <Field label="下一里程碑">
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="可选，比如：完成两次有效完整模考" style={inputStyle} />
      </Field>
      <Field label="截止日期" hint="可选，填了会在总览页显示倒计时">
        <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="状态" group>
        <input value={status} onChange={e => setStatus(e.target.value)} placeholder="可选，比如：正常、轻度迟缓" maxLength={20} aria-label="状态" style={inputStyle} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATUS_SUGGESTIONS.map(s => (
            <button key={s} type="button" onClick={() => setStatus(s)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}>
              <Badge tone={status === s ? statusTone(s) : "neutral"}>{s}</Badge>
            </button>
          ))}
        </div>
      </Field>
      {goal && (
        <Field label={`进度 · ${progress}%`}>
          <input type="range" min={0} max={100} step={5} value={progress} onChange={e => setProgress(Number(e.target.value))} style={{ accentColor: colors.ink, cursor: "pointer" }} />
        </Field>
      )}
    </Modal>
  )
}

export default GoalPanel
