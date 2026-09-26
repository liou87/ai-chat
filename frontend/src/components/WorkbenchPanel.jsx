import { useState, useEffect } from "react"
import TaskPanel from "./TaskPanel"
import ReminderPanel from "./ReminderPanel"
import GoalPanel from "./GoalPanel"
import AssistantAvatar from "./AssistantAvatar"
import { useTheme } from "../ThemeContext"
import { moduleAccents, radiusMd } from "../theme"
import { PERSONA_NAME } from "../persona"
import { API, authHeaders } from "../api"

// 知行主动生成的今日简报，一天只生成一次（后端做缓存），这里只是读取展示，不带 refreshKey，
// 不会因为聊天里用了个工具就重新生成一遍。用淡色通栏而不是带边框的卡片，跟下面的功能卡片区分开，
// 一眼看出这是"知行说的话"而不是一个数据模块。
function DigestCard() {
  const { colors, isDark } = useTheme()
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
    <div style={{
      background: colors.primary + (isDark ? "1a" : "0e"),
      borderRadius: radiusMd,
      padding: "16px 18px",
      marginBottom: 16,
      flexShrink: 0,
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
    }}>
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

// 一张模块卡片：不用色块图标当门面，靠加粗标题 + 一条细的强调色左边框来区分模块，
// 内容区自己滚动，卡片高度由外层 flex 布局撑满
function ModuleCard({ title, accent, extra, children }) {
  const { colors } = useTheme()
  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: colors.surface,
      borderRadius: radiusMd,
      border: `1px solid ${colors.borderLight}`,
      borderLeft: `3px solid ${accent}`,
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "14px 16px 6px", flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.2, color: colors.text }}>{title}</span>
        {extra}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 16px 14px" }}>
        {children}
      </div>
    </div>
  )
}

// 总览只留四块最常看的东西：今日简报、任务、阶段目标、提醒——笔记/日记/AI热点都已经在侧栏有独立页面，
// 不用在总览里重复摆一遍。任务用得最勤，给它最大的一块；阶段目标和提醒次要，堆在右边窄列，
// 主次分明（bento 布局），不是四个大小一样的方框摆整齐。
function WorkbenchPanel({ refreshKey }) {
  const { colors } = useTheme()
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: 24, background: colors.pageBg, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 19, fontWeight: 600, color: colors.text }}>工作台总览</span>
          <span style={{ fontSize: 13, color: colors.textMuted }}>今日简报 · 任务 · 阶段目标 · 提醒</span>
        </div>
        <span style={{ fontSize: 13, color: colors.textMuted }}>
          {new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>

      <DigestCard />

      <div style={{ display: "flex", gap: 16, height: 520 }}>
        <div style={{ flex: 1.6, minWidth: 0 }}>
          <ModuleCard title="任务" accent={moduleAccents.tasks}>
            <TaskPanel refreshKey={refreshKey} accent={moduleAccents.tasks} />
          </ModuleCard>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <ModuleCard title="阶段目标" accent={moduleAccents.goals}>
            <GoalPanel refreshKey={refreshKey} accent={moduleAccents.goals} />
          </ModuleCard>
          <ModuleCard title="提醒" accent={moduleAccents.reminders}>
            <ReminderPanel refreshKey={refreshKey} accent={moduleAccents.reminders} />
          </ModuleCard>
        </div>
      </div>

      </div>
    </div>
  )
}

export default WorkbenchPanel
