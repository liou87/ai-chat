import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"
import { useTheme } from "../ThemeContext"

// 定时轮询到期提醒（后台 APScheduler 每 60s 扫描一次并标记 fired），
// 有到期的就在顶部弹条幅，点"知道了"直接删除该提醒。
// refreshKey 变化时（agent 刚用过工具）立刻查一次，不用等 20s 轮询。
function ReminderBanner({ refreshKey }) {
  const { colors } = useTheme()
  const [dueReminders, setDueReminders] = useState([])

  const checkDue = async () => {
    try {
      const res = await fetch(`${API}/reminders/due`, { headers: authHeaders })
      if (res.ok) setDueReminders(await res.json())
    } catch {
      // 网络错误静默忽略，下次轮询再试
    }
  }

  useEffect(() => {
    checkDue()
    const timer = setInterval(checkDue, 20000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (refreshKey) checkDue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const dismiss = async (id) => {
    await fetch(`${API}/reminders/${id}`, { method: "DELETE", headers: authHeaders })
    setDueReminders(prev => prev.filter(r => r.id !== id))
  }

  if (dueReminders.length === 0) return null

  return (
    <div style={{ background: colors.warningBg, borderBottom: `1px solid ${colors.warningBorder}` }}>
      {dueReminders.map(r => (
        <div
          key={r.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 16px",
          }}
        >
          <span style={{ color: colors.warningText }}>⏰ {r.message}</span>
          <button
            onClick={() => dismiss(r.id)}
            style={{ border: "none", background: "none", color: colors.warningText, cursor: "pointer", fontWeight: "bold" }}
          >
            知道了
          </button>
        </div>
      ))}
    </div>
  )
}

export default ReminderBanner
