import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents, formMaxWidth } from "../theme"
import { ModuleIcon } from "../icons"
import LoadError from "./LoadError"

// 提醒管理面板：能看到所有提醒（待触发/已到期）、手动新建、取消。
// 到期后的弹窗提示由 ReminderBanner 负责，这里是"管理"视图。
// mode="expanded" 用于图标栏点开的单模块全页视图：创建表单横排、行更宽松。
function ReminderPanel({ refreshKey, accent = moduleAccents.reminders, mode = "compact" }) {
  const { colors, inputStyle, accentButtonStyle } = useTheme()
  const expanded = mode === "expanded"
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [message, setMessage] = useState("")
  const [remindAt, setRemindAt] = useState("")

  const fetchReminders = async () => {
    setLoading(true)
    try {
      setReminders(await apiFetch("/reminders"))
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReminders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const addReminder = async () => {
    if (!message.trim() || !remindAt) return
    try {
      await apiFetch("/reminders", { method: "POST", body: { message, remind_at: remindAt } })
      setMessage("")
      setRemindAt("")
      setActionError(null)
    } catch (e) {
      setActionError(e.message)
    }
    fetchReminders()
  }

  const cancelReminder = async (id) => {
    try {
      await apiFetch(`/reminders/${id}`, { method: "DELETE" })
      setActionError(null)
    } catch (e) {
      setActionError(e.message)
    }
    fetchReminders()
  }

  const upcoming = reminders
    .filter(r => !r.fired)
    .sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
  const fired = reminders.filter(r => r.fired)

  return (
    <div>
      <div style={{ display: "flex", flexDirection: expanded ? "row" : "column", gap: 6, marginBottom: expanded ? 20 : 12, maxWidth: expanded ? formMaxWidth * 1.4 : undefined }}>
        <input
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="提醒内容"
          aria-label="提醒内容"
          style={{ ...inputStyle, flex: expanded ? 2 : undefined }}
        />
        <input
          type="datetime-local"
          value={remindAt}
          onChange={e => setRemindAt(e.target.value)}
          aria-label="提醒时间"
          style={{ ...inputStyle, flex: expanded ? 1 : undefined }}
        />
        <button onClick={addReminder} style={{ ...accentButtonStyle(accent), whiteSpace: "nowrap" }}>+ 新建提醒</button>
      </div>

      {actionError && <div style={{ marginBottom: 8 }}><LoadError message={actionError} /></div>}
      {loading && reminders.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {error && <LoadError message={error} onRetry={fetchReminders} />}
      {!loading && !error && reminders.length === 0 && <div style={{ color: colors.textMuted }}>暂无提醒</div>}

      {upcoming.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>待触发</div>
          {upcoming.map(r => <ReminderRow key={r.id} r={r} expanded={expanded} onCancel={cancelReminder} />)}
        </>
      )}

      {fired.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: colors.textMuted, margin: "12px 0 6px" }}>已到期</div>
          {fired.map(r => <ReminderRow key={r.id} r={r} expanded={expanded} onCancel={cancelReminder} />)}
        </>
      )}
    </div>
  )
}

function ReminderRow({ r, expanded, onCancel }) {
  const { colors, iconButtonStyle } = useTheme()
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: expanded ? "12px 14px" : "8px 0",
        marginBottom: expanded ? 8 : 0,
        borderRadius: expanded ? 10 : 0,
        border: expanded ? `1px solid ${colors.borderLight}` : "none",
        borderBottom: `1px solid ${colors.borderLight}`,
      }}
    >
      <ModuleIcon name={r.fired ? "reminders" : "clock"} color={r.fired ? colors.warningText : colors.textMuted} size={16} />
      <span style={{ flex: 1, fontSize: expanded ? 15 : 14, color: colors.text }}>
        {r.message}
        <div style={{ fontSize: 11, color: colors.textMuted }}>{new Date(r.remind_at).toLocaleString()}</div>
      </span>
      <button onClick={() => onCancel(r.id)} style={iconButtonStyle} title="取消" aria-label={`取消提醒：${r.message}`}>×</button>
    </div>
  )
}

export default ReminderPanel
