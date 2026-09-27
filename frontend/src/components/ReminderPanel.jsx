import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { disabledStyle } from "../theme"
import { ModuleIcon } from "../icons"
import { formatShort } from "../datetime"
import { notificationPermission, requestNotificationPermission, REMINDERS_CHANGED_EVENT } from "../notify"
import LoadError from "./LoadError"

const byTime = (a, b) => new Date(a.remind_at) - new Date(b.remind_at)

// 提醒管理面板：待触发 / 到期未读 / 已读三组，手动新建、删除，已读的可以一键清理。
// 到期后的顶部条幅和系统通知由 ReminderBanner 负责，这里是"管理"视图。
// 总览页的"今日安排"卡片是 WorkbenchPanel 自己画的，这里只有单模块全页视图。
function ReminderPanel({ refreshKey }) {
  const { colors, inputStyle, darkButtonStyle } = useTheme()
  const confirm = useConfirm()
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [message, setMessage] = useState("")
  const [remindAt, setRemindAt] = useState("")
  const [adding, setAdding] = useState(false)
  const [permission, setPermission] = useState(notificationPermission)

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
      fetchReminders()
      window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT))
    }
  }

  const enableNotifications = async () => setPermission(await requestNotificationPermission())

  const canAdd = message.trim() !== "" && remindAt !== "" && !adding
  const addHint = !message.trim() && !remindAt ? "填写提醒内容和时间" : !message.trim() ? "填写提醒内容" : !remindAt ? "选择提醒时间" : undefined

  const addReminder = async () => {
    if (!canAdd) return
    // 新建提醒是一次用户点击，顺带请求通知权限，浏览器不会拦
    if (permission === "default") enableNotifications()
    setAdding(true)
    const ok = await mutate(() => apiFetch("/reminders", { method: "POST", body: { message: message.trim(), remind_at: remindAt } }))
    setAdding(false)
    if (ok) {
      setMessage("")
      setRemindAt("")
    }
  }

  const deleteReminder = async (r) => {
    if (!(await confirm({ title: "删除提醒", message: `「${r.message}」删除后无法恢复。` }))) return
    await mutate(() => apiFetch(`/reminders/${r.id}`, { method: "DELETE" }))
  }

  const acknowledge = (r) => mutate(() => apiFetch(`/reminders/${r.id}/acknowledge`, { method: "PATCH" }))

  const upcoming = reminders.filter(r => !r.fired).sort(byTime)
  const dueUnread = reminders.filter(r => r.fired && !r.acknowledged).sort(byTime)
  const done = reminders.filter(r => r.fired && r.acknowledged).sort((a, b) => byTime(b, a))

  const clearDone = async () => {
    if (!(await confirm({ title: "清空已读提醒", message: `${done.length} 条已读提醒会被删除，无法恢复。`, confirmText: "清空" }))) return
    await mutate(() => Promise.all(done.map(r => apiFetch(`/reminders/${r.id}`, { method: "DELETE" }))))
  }

  const visibleCount = upcoming.length + dueUnread.length + done.length

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="提醒内容"
          aria-label="提醒内容"
          style={{ ...inputStyle, flex: "2 1 200px" }}
        />
        <input
          type="datetime-local"
          value={remindAt}
          onChange={e => setRemindAt(e.target.value)}
          aria-label="提醒时间"
          style={{ ...inputStyle, flex: "1 1 180px" }}
        />
        <button
          onClick={addReminder}
          disabled={!canAdd}
          title={addHint}
          style={{ ...darkButtonStyle, whiteSpace: "nowrap", ...(!canAdd ? disabledStyle : {}) }}
        >
          {adding ? "添加中..." : "+ 新建提醒"}
        </button>
      </div>

      {permission === "default" && (
        <div style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <span>页面在后台时也想收到提醒？</span>
          <button onClick={enableNotifications} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: colors.primary }}>开启系统通知</button>
        </div>
      )}
      {permission === "denied" && (
        <div style={{ fontSize: 12.5, color: colors.textMuted, marginBottom: 16 }}>系统通知已被浏览器禁止，可以在地址栏左侧的网站设置里重新打开。</div>
      )}
      {permission !== "default" && permission !== "denied" && <div style={{ height: 8 }} />}

      {actionError && <div style={{ marginBottom: 8 }}><LoadError message={actionError} /></div>}
      {loading && reminders.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {error && <LoadError message={error} onRetry={fetchReminders} />}
      {!loading && !error && visibleCount === 0 && <div style={{ color: colors.textMuted }}>暂无提醒</div>}

      {dueUnread.length > 0 && (
        <>
          <GroupLabel colors={colors} first>到期未读 · {dueUnread.length}</GroupLabel>
          {dueUnread.map(r => <ReminderRow key={r.id} r={r} onAcknowledge={acknowledge} onDelete={deleteReminder} />)}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <GroupLabel colors={colors} first={dueUnread.length === 0}>待触发 · {upcoming.length}</GroupLabel>
          {upcoming.map(r => <ReminderRow key={r.id} r={r} onDelete={deleteReminder} />)}
        </>
      )}

      {done.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <GroupLabel colors={colors} first={dueUnread.length === 0 && upcoming.length === 0}>已读 · {done.length}</GroupLabel>
            <button onClick={clearDone} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12, color: colors.textMuted, marginTop: dueUnread.length === 0 && upcoming.length === 0 ? 0 : 10 }}>清空</button>
          </div>
          {done.map(r => <ReminderRow key={r.id} r={r} onDelete={deleteReminder} />)}
        </>
      )}
    </div>
  )
}

function GroupLabel({ children, colors, first }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, margin: first ? "0 0 6px" : "16px 0 6px" }}>{children}</div>
}

function ReminderRow({ r, onAcknowledge, onDelete }) {
  const { colors, iconButtonStyle } = useTheme()
  const unread = r.fired && !r.acknowledged
  const read = r.fired && r.acknowledged
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 14px",
        marginBottom: 8,
        borderRadius: 10,
        border: `1px solid ${colors.cardBorder}`,
        background: colors.cardBg,
        opacity: read ? 0.65 : 1,
      }}
    >
      <ModuleIcon name={r.fired ? "reminders" : "clock"} color={unread ? colors.warningText : colors.textMuted} size={16} />
      <span style={{ flex: 1, fontSize: 15, color: colors.text }}>
        {r.message}
        <div style={{ fontSize: 11, color: colors.textMuted }}>{formatShort(r.remind_at)}</div>
      </span>
      {unread && onAcknowledge && (
        <button onClick={() => onAcknowledge(r)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12, color: colors.warningText }}>知道了</button>
      )}
      <button onClick={() => onDelete(r)} style={iconButtonStyle} title="删除" aria-label={`删除提醒：${r.message}`}>×</button>
    </div>
  )
}

export default ReminderPanel
