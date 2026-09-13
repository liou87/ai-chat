import { useState, useEffect } from "react"
import { API, authHeaders } from "../api"

// 定时轮询到期提醒（后台 APScheduler 每 60s 扫描一次并标记 fired），
// 有到期的就在顶部弹条幅，点"知道了"直接删除该提醒。
function ReminderBanner() {
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
  }, [])

  const dismiss = async (id) => {
    await fetch(`${API}/reminders/${id}`, { method: "DELETE", headers: authHeaders })
    setDueReminders(prev => prev.filter(r => r.id !== id))
  }

  if (dueReminders.length === 0) return null

  return (
    <div style={{ background: "#fff3cd", borderBottom: "1px solid #ffe69c" }}>
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
          <span>⏰ {r.message}</span>
          <button
            onClick={() => dismiss(r.id)}
            style={{ border: "none", background: "none", color: "#856404", cursor: "pointer", fontWeight: "bold" }}
          >
            知道了
          </button>
        </div>
      ))}
    </div>
  )
}

export default ReminderBanner
