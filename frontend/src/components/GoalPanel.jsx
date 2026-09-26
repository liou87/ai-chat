import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents, formMaxWidth } from "../theme"
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
// mode="compact" 用在总览卡片里，只显示阶段目标的进度；mode="expanded" 显示完整层级，可以新建/删除/改进度。
function GoalPanel({ refreshKey, accent = moduleAccents.goals, mode = "compact" }) {
  const { colors, inputStyle, accentButtonStyle, iconButtonStyle } = useTheme()
  const expanded = mode === "expanded"
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ tier: "phase", parent_id: "", title: "", description: "" })

  const fetchGoals = async () => {
    setLoading(true)
    try {
      setGoals(await apiFetch("/goals"))
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
    } catch (e) {
      setActionError(e.message)
    }
    fetchGoals()
  }

  const phases = goals.filter(g => g.tier === "phase")
  const byParent = (parentId) => goals.filter(g => g.parent_id === parentId)
  const parentOptions = goals.filter(g => g.tier === PARENT_TIER[form.tier])

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

  const deleteGoal = (id) => mutate(() => apiFetch(`/goals/${id}`, { method: "DELETE" }))

  if (!expanded) {
    // 紧凑视图：只看阶段目标的标题和进度条，跟截图里"目标与下一里程碑"卡片一个意思
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
        <GoalNode key={phase.id} goal={phase} depth={0} accent={accent} colors={colors} iconButtonStyle={iconButtonStyle}
                  byParent={byParent} onUpdateProgress={updateProgress} onDelete={deleteGoal} />
      ))}
    </div>
  )
}

function GoalNode({ goal, depth, accent, colors, iconButtonStyle, byParent, onUpdateProgress, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal.progress)
  const children = byParent(goal.id)

  return (
    <div style={{ marginLeft: depth * 18, marginBottom: 10 }}>
      <div style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${colors.borderLight}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 4, background: accent + "1f", color: accent, flexShrink: 0 }}>
            {TIER_LABEL[goal.tier]}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text, flex: 1 }}>{goal.title}</span>
          {goal.status && <span style={{ fontSize: 11, color: colors.textMuted }}>{goal.status}</span>}
          <button onClick={() => onDelete(goal.id)} style={iconButtonStyle} title="删除" aria-label={`删除：${goal.title}`}>×</button>
        </div>
        {goal.description && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{goal.description}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <div style={{ flex: 1 }}><ProgressBar percent={goal.progress} accent={accent} colors={colors} /></div>
          {editing ? (
            <>
              <input
                type="number" min={0} max={100} value={draft}
                onChange={e => setDraft(e.target.value)}
                style={{ width: 52, padding: "3px 6px", borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, fontSize: 12 }}
              />
              <button onClick={() => { onUpdateProgress(goal.id, Number(draft)); setEditing(false) }} style={{ fontSize: 12, color: accent, background: "none", border: "none", cursor: "pointer" }}>确定</button>
            </>
          ) : (
            <span onClick={() => { setDraft(goal.progress); setEditing(true) }} style={{ fontSize: 12, color: accent, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
              {goal.progress}%
            </span>
          )}
        </div>
      </div>
      {children.map(child => (
        <GoalNode key={child.id} goal={child} depth={depth + 1} accent={accent} colors={colors} iconButtonStyle={iconButtonStyle}
                  byParent={byParent} onUpdateProgress={onUpdateProgress} onDelete={onDelete} />
      ))}
    </div>
  )
}

export default GoalPanel
