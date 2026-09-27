import { useRef } from "react"
import TaskPanel from "./TaskPanel"
import ReminderPanel from "./ReminderPanel"
import GoalPanel from "./GoalPanel"
import AssistantAvatar from "./AssistantAvatar"
import { useTheme } from "../ThemeContext"
import { moduleAccents, radiusMd } from "../theme"
import { PERSONA_NAME } from "../persona"
import LoadError from "./LoadError"
import { useElementWidth } from "../hooks"

// 知行主动生成的今日简报，一天只生成一次（后端做缓存）。数据由 App 统一请求一次后传进来，
// 跟聊天开场白共用；不带 refreshKey，不会因为聊天里用了个工具就重新生成一遍。用淡色通栏而不是带边框的卡片，
// 跟下面的功能卡片区分开，一眼看出这是"知行说的话"而不是一个数据模块。
// 标出生成时间，让人知道生成之后才加的任务不在里面。
function DigestCard({ digest, onRetry, onRegenerate }) {
  const { colors, isDark } = useTheme()
  const { data, loading, error } = digest
  const generatedAt = data?.created_at
    ? new Date(data.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : null

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
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 3, display: "flex", alignItems: "baseline", gap: 8 }}>
          {PERSONA_NAME}的今日简报
          {generatedAt && <span style={{ fontWeight: 400 }}>{generatedAt} 生成</span>}
          {!loading && (
            <button onClick={onRegenerate} style={{ marginLeft: "auto", border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 400, color: colors.textSecondary }}>
              重新生成
            </button>
          )}
        </div>
        <div style={{ fontSize: 13.5, color: colors.text, lineHeight: 1.55 }}>
          {loading ? "生成中..." : error ? <LoadError message={error} onRetry={onRetry} /> : (data?.content || "今天还没有简报")}
        </div>
      </div>
    </div>
  )
}

// 一张模块卡片：不用色块图标当门面，靠加粗标题 + 一条细的强调色左边框来区分模块，
// 背景用该模块强调色的极淡洗色（跟今日简报卡片一个做法），不是平面白色，
// 内容区自己滚动，卡片高度由外层 flex 布局撑满
function ModuleCard({ title, accent, extra, children }) {
  const { colors, isDark } = useTheme()
  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      background: accent + (isDark ? "1a" : "0e"),
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

// 主区域窄于这个宽度就把 bento 双列改成单列堆叠，免得任务卡片被挤得太窄
const SINGLE_COLUMN_BELOW = 720
// 双列时卡片区的最小高度：屏幕高就撑满简报下方的空间，屏幕矮就保底这么高、整页滚动
const GRID_MIN_HEIGHT = 480

// 总览只留四块最常看的东西：今日简报、任务、阶段目标、提醒——笔记/日记/AI热点都已经在侧栏有独立页面，
// 不用在总览里重复摆一遍。任务用得最勤，给它最大的一块；阶段目标和提醒次要，堆在右边窄列，
// 主次分明（bento 布局），不是四个大小一样的方框摆整齐。
function WorkbenchPanel({ refreshKey, digest, onRetryDigest, onRegenerateDigest }) {
  const { colors } = useTheme()
  const containerRef = useRef(null)
  const width = useElementWidth(containerRef)
  const singleColumn = width > 0 && width < SINGLE_COLUMN_BELOW

  const tasksCard = (
    <ModuleCard title="任务" accent={moduleAccents.tasks}>
      <TaskPanel refreshKey={refreshKey} accent={moduleAccents.tasks} />
    </ModuleCard>
  )
  const goalsCard = (
    <ModuleCard title="目标" accent={moduleAccents.goals}>
      <GoalPanel refreshKey={refreshKey} accent={moduleAccents.goals} />
    </ModuleCard>
  )
  const remindersCard = (
    <ModuleCard title="提醒" accent={moduleAccents.reminders}>
      <ReminderPanel refreshKey={refreshKey} accent={moduleAccents.reminders} />
    </ModuleCard>
  )

  return (
    <div ref={containerRef} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: singleColumn ? 16 : 24, background: colors.pageBg, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 10px", marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 19, fontWeight: 600, color: colors.text }}>工作台总览</span>
          {!singleColumn && <span style={{ fontSize: 13, color: colors.textMuted }}>今日简报 · 任务 · 目标 · 提醒</span>}
        </div>
        <span style={{ fontSize: 13, color: colors.textMuted }}>
          {new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
        </span>
      </div>

      {/* 滚动容器本身是 flex 列：简报按内容高度，卡片区 flex: 1 吃掉剩下的高度 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <DigestCard digest={digest} onRetry={onRetryDigest} onRegenerate={onRegenerateDigest} />

        {singleColumn ? (
          // 单列：每张卡片给个固定的舒适高度，内容多了卡片内部滚动，整页也能滚
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ height: 420, display: "flex" }}>{tasksCard}</div>
            <div style={{ height: 260, display: "flex" }}>{goalsCard}</div>
            <div style={{ height: 340, display: "flex" }}>{remindersCard}</div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: GRID_MIN_HEIGHT, display: "flex", gap: 16 }}>
            <div style={{ flex: 1.6, minWidth: 0, display: "flex" }}>{tasksCard}</div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              {goalsCard}
              {remindersCard}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkbenchPanel
