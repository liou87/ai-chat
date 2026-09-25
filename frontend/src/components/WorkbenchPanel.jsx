import { useState, useEffect } from "react"
import TaskPanel from "./TaskPanel"
import NotePanel from "./NotePanel"
import ReminderPanel from "./ReminderPanel"
import AssistantAvatar from "./AssistantAvatar"
import { useTheme } from "../ThemeContext"
import { moduleAccents } from "../theme"
import { ModuleIcon } from "../icons"
import { PERSONA_NAME } from "../persona"
import { API, authHeaders } from "../api"

// 知行主动生成的今日简报，一天只生成一次（后端做缓存），这里只是读取展示，不带 refreshKey，
// 不会因为聊天里用了个工具就重新生成一遍
function DigestCard() {
  const { colors, cardStyle } = useTheme()
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/digest/today`, { headers: authHeaders })
      .then(res => res.json())
      .then(data => { if (!cancelled) setDigest(data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ ...cardStyle, display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", marginBottom: 16, flexShrink: 0 }}>
      <AssistantAvatar size={30} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 3 }}>{PERSONA_NAME}的今日简报</div>
        <div style={{ fontSize: 13.5, color: colors.text, lineHeight: 1.55 }}>
          {loading ? "生成中..." : (digest?.content || "今天还没有简报")}
        </div>
      </div>
    </div>
  )
}

// 一张模块卡片：带强调色的图标+标题头，内容区自己滚动，卡片本身高度由外层网格决定
function ModuleCard({ iconName, title, accent, extra, children }) {
  const { colors, cardStyle, isDark } = useTheme()
  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${colors.borderLight}`, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: accent + (isDark ? "33" : "1f"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <ModuleIcon name={iconName} color={accent} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 15, color: colors.text }}>{title}</span>
        {extra}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
        {children}
      </div>
    </div>
  )
}

// 四个模块摆成 2x2 网格，一屏看到全部概览，不再靠 tab 切换隐藏内容
function WorkbenchPanel({ refreshKey, onRequestWeeklyReview }) {
  const { colors } = useTheme()
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: 24, background: colors.pageBg }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 19, fontWeight: 600, color: colors.text }}>工作台总览</span>
        <span style={{ fontSize: 13, color: colors.textMuted }}>任务 / 笔记 / 日记 / 提醒，一屏看完</span>
      </div>

      <DigestCard />

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 16 }}>
        <ModuleCard iconName="tasks" title="任务" accent={moduleAccents.tasks}>
          <TaskPanel refreshKey={refreshKey} accent={moduleAccents.tasks} />
        </ModuleCard>

        <ModuleCard iconName="notes" title="笔记" accent={moduleAccents.notes}>
          <NotePanel refreshKey={refreshKey} category="note" accent={moduleAccents.notes} />
        </ModuleCard>

        <ModuleCard iconName="journal" title="日记" accent={moduleAccents.journal}>
          <NotePanel
            refreshKey={refreshKey}
            category="journal"
            accent={moduleAccents.journal}
            onRequestWeeklyReview={onRequestWeeklyReview}
          />
        </ModuleCard>

        <ModuleCard iconName="reminders" title="提醒" accent={moduleAccents.reminders}>
          <ReminderPanel refreshKey={refreshKey} accent={moduleAccents.reminders} />
        </ModuleCard>
      </div>
    </div>
  )
}

export default WorkbenchPanel
