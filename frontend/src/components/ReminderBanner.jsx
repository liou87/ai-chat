import { useState, useEffect } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { ModuleIcon } from "../icons"

// 定时轮询到期提醒（后台 APScheduler 每 60s 扫描一次并标记 fired），
// 有到期的就在顶部弹条幅，点"知道了"直接删除该提醒。
// refreshKey 变化时（agent 刚用过工具）立刻查一次，不用等 20s 轮询。
function ReminderBanner({ refreshKey }) {
  const { colors } = useTheme()
  const [dueReminders, setDueReminders] = useState([])

  const checkDue = async () => {
    try {
      setDueReminders(await apiFetch("/reminders/due"))
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
    setDueReminders(prev => prev.filter(r => r.id !== id))
    try {
      await apiFetch(`/reminders/${id}`, { method: "DELETE" })
    } catch {
      // 删除失败的话下次轮询它会重新出现，不单独提示
    }
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
          <span style={{ color: colors.warningText, display: "flex", alignItems: "center", gap: 8 }}>
            <ModuleIcon name="reminders" color="currentColor" size={15} />
            {r.message}
          </span>
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
