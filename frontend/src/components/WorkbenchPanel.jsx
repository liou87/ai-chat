import { useState } from "react"
import TaskPanel from "./TaskPanel"
import NotePanel from "./NotePanel"
import ReminderPanel from "./ReminderPanel"
import { colors } from "../theme"

const TABS = [
  { key: "tasks", label: "任务" },
  { key: "notes", label: "笔记" },
  { key: "journal", label: "日记" },
  { key: "reminders", label: "提醒" },
]

// 把 任务/笔记/日记/提醒 收进一个带 tab 的工作台面板，
// 避免每加一个模块就多占一整列，页面维持"会话 / 聊天 / 工作台"三栏。
function WorkbenchPanel({ refreshKey, onRequestWeeklyReview }) {
  const [activeTab, setActiveTab] = useState("tasks")

  return (
    <div style={{ width: 320, borderLeft: `1px solid ${colors.border}`, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${colors.border}` }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1,
              padding: "10px 0",
              border: "none",
              borderBottom: activeTab === t.key ? `2px solid ${colors.primary}` : "2px solid transparent",
              background: "none",
              color: activeTab === t.key ? colors.primary : "#333",
              fontWeight: activeTab === t.key ? 600 : 400,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {activeTab === "tasks" && <TaskPanel refreshKey={refreshKey} />}
        {activeTab === "notes" && <NotePanel refreshKey={refreshKey} category="note" />}
        {activeTab === "journal" && (
          <NotePanel refreshKey={refreshKey} category="journal" onRequestWeeklyReview={onRequestWeeklyReview} />
        )}
        {activeTab === "reminders" && <ReminderPanel refreshKey={refreshKey} />}
      </div>
    </div>
  )
}

export default WorkbenchPanel
