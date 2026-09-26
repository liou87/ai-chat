import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { moduleAccents, formMaxWidth } from "../theme"
import { isSubmitEnter } from "../keyboard"
import LoadError from "./LoadError"

const TIER_LABEL = { phase: "阶段目标", month: "月目标", week: "周目标" }
const PARENT_TIER = { phase: null, month: "phase", week: "month" }

// 进度条：跟主题走，accent 是当前颜色，percent 是 0-100
function ProgressBar({ percent, accent, colors }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: colors.borderLight, overflow: "hidden" }}>
      <div style={{ width: `${percent}%`, height: "100%", background: accent, borderRadius: 3 }} />
    </div>
  )
}

// 目标面板：三层结构（阶段/月/周），month 挂在 phase 下，week 挂在 month 下。
// mode="compact" 用在总览卡片里，只显示阶段目标的进度；mode="expanded" 显示完整层级，
// 可以新建、编辑标题说明、拖动进度、看挂靠的任务、删除（删除会连带子目标，先确认）。
function GoalPanel({ refreshKey, accent = moduleAccents.goals, mode = "compact" }) {
  const { colors, inputStyle, accentButtonStyle } = useTheme()
  const confirm = useConfirm()
  const expanded = mode === "expanded"
  const [goals, setGoals] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ tier: "phase", parent_id: "", title: "", description: "" })

  const fetchGoals = async () => {
    setLoading(true)
    try {
      // 全页视图要显示每个目标下挂的任务，总览卡片用不到就不多拉一次
      const [goalList, taskList] = await Promise.all([apiFetch("/goals"), expanded ? apiFetch("/tasks") : []])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const phases = goals.filter(g => g.tier === "phase")
  const byParent = (parentId) => goals.filter(g => g.parent_id === parentId)
  const tasksOf = (goalId) => tasks.filter(t => t.goal_id === goalId)
  const parentOptions = goals.filter(g => g.tier === PARENT_TIER[form.tier])

  const countDescendants = (id) => byParent(id).reduce((n, child) => n + 1 + countDescendants(child.id), 0)

  const addGoal = async () => {
    if (!form.title.trim()) return
    if (PARENT_TIER[form.tier] && !form.parent_id) return  // month/week 必须选上级
    const body = {
      title: form.title,
      tier: form.tier,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      description: form.description || null,
    }
    setForm({ tier: "phase", parent_id: "", title: "", description: "" })
    setShowForm(false)
    await mutate(() => apiFetch("/goals", { method: "POST", body }))
  }

  const updateProgress = (id, progress) =>
    mutate(() => apiFetch(`/goals/${id}/progress`, { method: "PATCH", body: { progress } }))

  const updateGoal = (id, changes) => mutate(() => apiFetch(`/goals/${id}`, { method: "PATCH", body: changes }))

  const deleteGoal = async (goal) => {
    const children = countDescendants(goal.id)
    const linked = tasksOf(goal.id).length
    const lines = [`「${goal.title}」删除后无法恢复。`]
    if (children > 0) lines.push(`下面的 ${children} 个子目标会一起删除。`)
    if (linked > 0) lines.push(`挂在它下面的 ${linked} 个任务会保留，只是不再挂靠这个目标。`)
    if (!(await confirm({ title: `删除${TIER_LABEL[goal.tier]}`, message: lines.join("\n") }))) return
    await mutate(() => apiFetch(`/goals/${goal.id}`, { method: "DELETE" }))
  }

  if (!expanded) {
    // 紧凑视图：只看阶段目标的标题和进度条
    return (
      <div>
        {loading && phases.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
        {error && <LoadError message={error} onRetry={fetchGoals} />}
        {!loading && !error && phases.length === 0 && <div style={{ color: colors.textMuted }}>暂无目标</div>}
        {phases.map(g => (
          <div key={g.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: colors.text }}>{g.title}</span>
              <span style={{ color: accent, fontWeight: 600 }}>{g.progress}%</span>
            </div>
            <ProgressBar percent={g.progress} accent={accent} colors={colors} />
            {g.description && <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }}>{g.description}</div>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div style={{ maxWidth: formMaxWidth }}>
      {!showForm ? (
        <button onClick={() => setShowForm(true)} style={{ ...accentButtonStyle(accent), width: "100%", marginBottom: 16 }}>
          + 新建目标
        </button>
      ) : (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 10, border: `1px solid ${colors.borderLight}` }}>
          <div style={{ display: "flex", gap: 6 }}>
            <select
              value={form.tier}
              onChange={e => setForm({ ...form, tier: e.target.value, parent_id: "" })}
              style={{ ...inputStyle, flex: 1 }}
              aria-label="目标层级"
            >
              <option value="phase">阶段目标</option>
              <option value="month">月目标</option>
              <option value="week">周目标</option>
            </select>
            {PARENT_TIER[form.tier] && (
              <select
                value={form.parent_id}
                onChange={e => setForm({ ...form, parent_id: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
                aria-label="上级目标"
              >
                <option value="">选择上级（{TIER_LABEL[PARENT_TIER[form.tier]]}）</option>
                {parentOptions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            )}
          </div>
          <input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="目标标题"
            style={inputStyle}
          />
          <input
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="补充说明，比如下一个里程碑是什么（可选）"
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={addGoal} style={{ ...accentButtonStyle(accent), flex: 1 }}>保存</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "7px 12px", borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, cursor: "pointer" }}>取消</button>
          </div>
        </div>
      )}
      </div>

      {actionError && <div style={{ marginBottom: 10 }}><LoadError message={actionError} /></div>}
      {loading && goals.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {error && <LoadError message={error} onRetry={fetchGoals} />}
      {!loading && !error && phases.length === 0 && <div style={{ color: colors.textMuted }}>暂无目标</div>}

      {phases.map(phase => (
        <GoalNode key={phase.id} goal={phase} depth={0} accent={accent} byParent={byParent} tasksOf={tasksOf}
                  onUpdateProgress={updateProgress} onUpdate={updateGoal} onDelete={deleteGoal} />
      ))}
    </div>
  )
}

function GoalNode({ goal, depth, accent, byParent, tasksOf, onUpdateProgress, onUpdate, onDelete }) {
  const { colors, inputStyle, buttonStyle, accentButtonStyle, iconButtonStyle } = useTheme()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: goal.title, description: goal.description || "" })
  // 拖动中的进度先只改本地显示，松手才提交。记下拖动开始时服务端的值（from）：
  // 提交后列表刷新、服务端的值变了，就自然切回显示服务端的值，不会在刷新前闪回旧值；
  // agent 在聊天里改了进度也一样，以服务端为准
  const [drag, setDrag] = useState(null)  // { value, from, committed }
  const children = byParent(goal.id)
  const linkedTasks = tasksOf(goal.id)
  const doneCount = linkedTasks.filter(t => t.done).length
  const progress = drag && drag.from === goal.progress ? drag.value : goal.progress

  const commitProgress = () => {
    if (!drag || drag.committed || drag.from !== goal.progress) return
    if (drag.value === goal.progress) {
      setDrag(null)
      return
    }
    setDrag({ ...drag, committed: true })
    onUpdateProgress(goal.id, drag.value)
  }

  const startEdit = () => {
    setDraft({ title: goal.title, description: goal.description || "" })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!draft.title.trim()) return
    await onUpdate(goal.id, { title: draft.title.trim(), description: draft.description.trim() })
    setEditing(false)
  }

  return (
    <div style={{ marginLeft: depth * 18, marginBottom: 10 }}>
      <div style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${colors.borderLight}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 4, background: accent + "1f", color: accent, flexShrink: 0 }}>
            {TIER_LABEL[goal.tier]}
          </span>
          {editing ? (
            <input
              value={draft.title}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
              onKeyDown={e => isSubmitEnter(e) && saveEdit()}
              aria-label="目标标题"
              style={{ ...inputStyle, flex: 1, minWidth: 0, fontWeight: 600 }}
              autoFocus
            />
          ) : (
            <button
              onClick={startEdit}
              title="点击编辑"
              style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: "inherit" }}
            >
              {goal.title}
            </button>
          )}
          {goal.status && <span style={{ fontSize: 11, color: colors.textMuted }}>{goal.status}</span>}
          <button onClick={() => onDelete(goal)} style={iconButtonStyle} title="删除" aria-label={`删除：${goal.title}`}>×</button>
        </div>

        {editing ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              onKeyDown={e => isSubmitEnter(e) && saveEdit()}
              placeholder="补充说明（可选）"
              aria-label="目标说明"
              style={inputStyle}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button onClick={() => setEditing(false)} style={buttonStyle}>取消</button>
              <button onClick={saveEdit} style={accentButtonStyle(accent)}>保存</button>
            </div>
          </div>
        ) : (
          goal.description && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{goal.description}</div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <input
            type="range" min={0} max={100} step={5}
            value={progress}
            onChange={e => setDrag({ value: Number(e.target.value), from: goal.progress, committed: false })}
            onPointerUp={commitProgress}
            onKeyUp={commitProgress}
            onBlur={commitProgress}
            aria-label={`${goal.title} 的进度`}
            style={{ flex: 1, accentColor: accent, cursor: "pointer" }}
          />
          <span style={{ fontSize: 12, color: accent, fontWeight: 600, width: 36, textAlign: "right", flexShrink: 0 }}>{progress}%</span>
        </div>

        {linkedTasks.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${colors.borderLight}` }}>
            <div style={{ fontSize: 11.5, color: colors.textMuted, marginBottom: 4 }}>挂靠任务 · 完成 {doneCount}/{linkedTasks.length}</div>
            {linkedTasks.map(t => (
              <div key={t.id} style={{ fontSize: 12.5, color: t.done ? colors.textMuted : colors.textSecondary, textDecoration: t.done ? "line-through" : "none", padding: "2px 0" }}>
                {t.done ? "✓" : "·"} {t.title}
              </div>
            ))}
          </div>
        )}
      </div>
      {children.map(child => (
        <GoalNode key={child.id} goal={child} depth={depth + 1} accent={accent} byParent={byParent} tasksOf={tasksOf}
                  onUpdateProgress={onUpdateProgress} onUpdate={onUpdate} onDelete={onDelete} />
      ))}
    </div>
  )
}

export default GoalPanel
