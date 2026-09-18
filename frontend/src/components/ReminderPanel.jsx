import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents } from "../theme"

// 提醒管理面板：能看到所有提醒（待触发/已到期）、手动新建、取消。
// 到期后的弹窗提示由 ReminderBanner 负责，这里是"管理"视图。
// mode="expanded" 用于图标栏点开的单模块全页视图：创建表单横排、行更宽松。
function ReminderPanel({ refreshKey, accent = moduleAccents.reminders, mode = "compact" }) {
  const { colors, inputStyle, accentButtonStyle } = useTheme()
  const expanded = mode === "expanded"
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [remindAt, setRemindAt] = useState("")

  const fetchReminders = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/reminders`, { headers: authHeaders })
      setReminders(await res.json())
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
    await fetch(`${API}/reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ message, remind_at: remindAt })
    })
    setMessage("")
    setRemindAt("")
    fetchReminders()
  }

  const cancelReminder = async (id) => {
    await fetch(`${API}/reminders/${id}`, { method: "DELETE", headers: authHeaders })
    fetchReminders()
  }

  const upcoming = reminders
    .filter(r => !r.fired)
    .sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
  const fired = reminders.filter(r => r.fired)

  return (
    <div>
      <div style={{ display: "flex", flexDirection: expanded ? "row" : "column", gap: 6, marginBottom: expanded ? 20 : 12 }}>
        <input
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="提醒内容"
          style={{ ...inputStyle, flex: expanded ? 2 : undefined }}
        />
        <input
          type="datetime-local"
          value={remindAt}
          onChange={e => setRemindAt(e.target.value)}
          style={{ ...inputStyle, flex: expanded ? 1 : undefined }}
        />
        <button onClick={addReminder} style={{ ...accentButtonStyle(accent), whiteSpace: "nowrap" }}>+ 新建提醒</button>
      </div>

      {loading && reminders.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && reminders.length === 0 && <div style={{ color: colors.textMuted }}>暂无提醒</div>}

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
      <span style={{ fontSize: 16 }}>{r.fired ? "🔔" : "⏰"}</span>
      <span style={{ flex: 1, fontSize: expanded ? 15 : 14, color: colors.text }}>
        {r.message}
        <div style={{ fontSize: 11, color: colors.textMuted }}>{new Date(r.remind_at).toLocaleString()}</div>
      </span>
      <button onClick={() => onCancel(r.id)} style={iconButtonStyle} title="取消">×</button>
    </div>
  )
}

export default ReminderPanel
