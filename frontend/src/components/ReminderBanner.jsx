import { useState, useEffect, useRef } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { ModuleIcon } from "../icons"
import { formatShort } from "../datetime"
import { showSystemNotification, playChime, REMINDERS_CHANGED_EVENT } from "../notify"

// 定时轮询到期提醒（后台 APScheduler 每 60s 扫描一次并标记 fired），
// 有到期未读的就在顶部弹条幅；点"知道了"只是标记已读，提醒本身保留在提醒页的"已读"分组里。
// 每条提醒第一次出现时额外发一条系统通知、响一声，标签页在后台也能注意到。
// refreshKey 变化时（agent 刚用过工具）立刻查一次，不用等 20s 轮询；自己这边有变化时通过 onChange 通知外层刷新各面板。
function ReminderBanner({ refreshKey, onChange }) {
  const { colors } = useTheme()
  const [dueReminders, setDueReminders] = useState([])
  const notifiedIds = useRef(new Set())

  const checkDue = async () => {
    try {
      const due = await apiFetch("/reminders/due")
      setDueReminders(due)
      const fresh = due.filter(r => !notifiedIds.current.has(r.id))
      if (fresh.length > 0) {
        fresh.forEach(r => {
          notifiedIds.current.add(r.id)
          showSystemNotification("知行提醒", r.message)
        })
        playChime()
        onChange?.()  // 提醒页/总览卡片里这条要从"待触发"挪到"到期未读"
      }
    } catch {
      // 网络错误静默忽略，下次轮询再试
    }
  }

  // checkDue 只读 ref、调 setState 和外层回调，每次渲染重建也不影响行为，不放进依赖
  useEffect(() => {
    checkDue()
    const timer = setInterval(checkDue, 20000)
    window.addEventListener(REMINDERS_CHANGED_EVENT, checkDue)
    return () => {
      clearInterval(timer)
      window.removeEventListener(REMINDERS_CHANGED_EVENT, checkDue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (refreshKey) checkDue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const acknowledge = async (id) => {
    setDueReminders(prev => prev.filter(r => r.id !== id))
    try {
      await apiFetch(`/reminders/${id}/acknowledge`, { method: "PATCH" })
      onChange?.()
    } catch {
      // 标记失败的话下次轮询它会重新出现，不单独提示
    }
  }

  if (dueReminders.length === 0) return null

  return (
    <div role="status" style={{ background: colors.warningBg, borderBottom: `1px solid ${colors.warningBorder}` }}>
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
            <span style={{ fontSize: 12, opacity: 0.75 }}>{formatShort(r.remind_at)}</span>
          </span>
          <button
            onClick={() => acknowledge(r.id)}
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
