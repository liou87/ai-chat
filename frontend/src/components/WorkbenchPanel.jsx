import { useEffect, useRef, useState } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { PERSONA_NAME } from "../persona"
import { useElementWidth } from "../hooks"
import { formatShort, daysUntil, startOfWeek, isToday } from "../datetime"
import { PRIORITY_LABEL, PRIORITY_TONE, byPriorityThenDue, formatMinutes, isOverdue } from "../taskMeta"
import LoadError from "./LoadError"
import { Badge, ProgressBar } from "./ui"
import { TaskFormModal } from "./TaskPanel"

// 主区域窄于这个宽度，两列卡片改成单列
const SINGLE_COLUMN_BELOW = 760
const KEY_TASK_COUNT = 3
const WEEKDAYS = "日一二三四五六"

const pad = (n) => String(n).padStart(2, "0")
const timeOf = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return "夜深了"
  if (h < 11) return "早上好"
  if (h < 13) return "中午好"
  if (h < 18) return "下午好"
  return "晚上好"
}

// 工作台总览（参考"个人成长工作台"的首页）：问候标题 + 目标倒计时，知行的今日建议，
// 关键任务 / 今日安排 / 目标与里程碑 / 本周概览四张白卡片。
// 数据都在这里一次拉齐，agent 用过工具后（refreshKey 变化）重新拉；
// 今日简报由 App 统一请求后传进来，跟聊天开场白共用，不跟着 refreshKey 重新生成。
function WorkbenchPanel({ refreshKey, digest, onRetryDigest, onRegenerateDigest, onNavigate, onRequestWeeklyReview }) {
  const { colors } = useTheme()
  const containerRef = useRef(null)
  const width = useElementWidth(containerRef)
  const singleColumn = width > 0 && width < SINGLE_COLUMN_BELOW

  const [data, setData] = useState({ tasks: [], goals: [], reminders: [], journal: [] })
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [adding, setAdding] = useState(false)

  const fetchAll = async () => {
    try {
      const [tasks, goals, reminders, journal] = await Promise.all([
        apiFetch("/tasks"), apiFetch("/goals"), apiFetch("/reminders"), apiFetch("/notes", { params: { category: "journal" } }),
      ])
      setData({ tasks, goals, reminders, journal })
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    fetchAll()
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
      fetchAll()
    }
  }

  // 打勾先改界面再发请求：请求加刷新要一两秒，不先改的话点了看起来像没反应。
  // 失败的话 mutate 最后会重新拉列表，界面自己恢复成服务端的状态，并显示错误
  const toggleDone = (t) => {
    setData(d => ({ ...d, tasks: d.tasks.map(x => x.id === t.id ? { ...x, done: !t.done, updated_at: new Date().toISOString() } : x) }))
    return mutate(() => apiFetch(`/tasks/${t.id}`, { method: "PATCH", body: { done: !t.done } }))
  }
  const addTask = async (values) => {
    const ok = await mutate(() => apiFetch("/tasks", { method: "POST", body: values }))
    if (ok) setAdding(false)
    return ok
  }

  const { tasks, goals, reminders, journal } = data
  const pending = tasks.filter(t => !t.done).sort(byPriorityThenDue)
  const keyTasks = pending.slice(0, KEY_TASK_COUNT)
  const now = new Date()

  const headline = pending.length === 0
    ? `${greeting()}，今天的待办都清空了。`
    : `${greeting()}，今天先完成最重要的${["", "一", "两", "三"][Math.min(KEY_TASK_COUNT, pending.length)]}件事。`

  return (
    <div ref={containerRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", background: colors.pageBg }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: singleColumn ? "24px 16px 40px" : "32px 32px 48px", boxSizing: "border-box" }}>

        {/* 问候标题 + 右侧倒计时胶囊 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>
              {now.getMonth() + 1}月{now.getDate()}日 · 星期{WEEKDAYS[now.getDay()]}
            </div>
            <h1 style={{ margin: 0, fontSize: singleColumn ? 24 : 30, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.3, color: colors.text }}>{headline}</h1>
          </div>
          <Countdowns goals={goals} pendingCount={pending.length} />
        </div>

        <DigestBanner digest={digest} onRetry={onRetryDigest} onRegenerate={onRegenerateDigest} />

        {error && <div style={{ marginBottom: 16 }}><LoadError message={error} onRetry={fetchAll} /></div>}
        {actionError && <div style={{ marginBottom: 16 }}><LoadError message={actionError} /></div>}

        <div style={{ display: "grid", gridTemplateColumns: singleColumn ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <KeyTasksCard
            loaded={loaded}
            keyTasks={keyTasks}
            pendingCount={pending.length}
            doneToday={tasks.filter(t => t.done && isToday(t.updated_at)).length}
            goals={goals}
            onToggle={toggleDone}
            onAdd={() => setAdding(true)}
            onViewAll={() => onNavigate("tasks")}
          />
          <ScheduleCard loaded={loaded} tasks={pending} reminders={reminders} onViewAll={() => onNavigate("reminders")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: singleColumn ? "1fr" : "1.6fr 1fr", gap: 16 }}>
          <GoalsCard loaded={loaded} goals={goals} onOpen={() => onNavigate("goals")} />
          <WeekCard tasks={tasks} journal={journal} onReview={onRequestWeeklyReview} />
        </div>
      </div>

      {adding && <TaskFormModal task={null} goals={goals} onSubmit={addTask} onClose={() => setAdding(false)} />}
    </div>
  )
}

// 标题右侧的胶囊：最近两个还没到期的目标倒计时；一个带截止日期的目标都没有时，退回显示待办数和目标数
function Countdowns({ goals, pendingCount }) {
  const { colors } = useTheme()
  const dated = goals
    .filter(g => g.target_date && daysUntil(g.target_date) >= 0 && g.progress < 100)
    .sort((a, b) => new Date(a.target_date) - new Date(b.target_date))
    .slice(0, 2)
  const pills = dated.length > 0
    ? dated.map(g => ({ key: g.id, value: daysUntil(g.target_date) === 0 ? "今天" : `${daysUntil(g.target_date)} 天`, label: g.title }))
    : [
        { key: "pending", value: pendingCount, label: "项待办" },
        { key: "goals", value: goals.filter(g => g.progress < 100).length, label: "个目标进行中" },
      ]
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      {pills.map(p => (
        <div key={p.key} title={p.label} style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "7px 12px", borderRadius: 8, background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, maxWidth: 260 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.text, whiteSpace: "nowrap" }}>{p.value}</span>
          <span style={{ fontSize: 13, color: colors.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
        </div>
      ))}
    </div>
  )
}

// 知行的今日建议（就是每日简报）：淡墨绿底 + 左侧墨绿竖线，跟下面的白卡片区分开，一眼看出是"知行说的话"。
// 标出生成时间，让人知道生成之后才加的任务不在里面
function DigestBanner({ digest, onRetry, onRegenerate }) {
  const { colors } = useTheme()
  const { data, loading, error } = digest
  const generatedAt = data?.created_at ? timeOf(data.created_at) : null
  return (
    <div style={{ background: colors.inkSoft, borderLeft: `3px solid ${colors.ink}`, borderRadius: 6, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>
          {PERSONA_NAME} · 今日建议{generatedAt && ` · ${generatedAt} 生成`}
        </div>
        <div style={{ fontSize: 14.5, color: colors.text, lineHeight: 1.6 }}>
          {loading ? "生成中..." : error ? <LoadError message={error} onRetry={onRetry} /> : (data?.content || "今天还没有建议")}
        </div>
      </div>
      {!loading && (
        <button onClick={onRegenerate} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 14, color: colors.ink, flexShrink: 0, fontFamily: "inherit" }}>
          重新生成
        </button>
      )}
    </div>
  )
}

// 卡片外壳：左上眉标 + 标题，右上一两个文字链接
function Card({ eyebrow, title, links = [], extra, children }) {
  const { colors, panelCardStyle } = useTheme()
  return (
    <div style={{ ...panelCardStyle, padding: "18px 22px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: colors.textMuted }}>{eyebrow}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: colors.text, marginTop: 2 }}>{title}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexShrink: 0 }}>
          {extra}
          {links.map(l => (
            <button key={l.label} onClick={l.onClick} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 14, color: colors.ink, fontFamily: "inherit" }}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}

function Empty({ children }) {
  const { colors } = useTheme()
  return <div style={{ fontSize: 13.5, color: colors.textMuted, padding: "12px 0" }}>{children}</div>
}

// 关键任务：按优先级、截止时间取前三条未完成的，可以直接打勾；底部是今天的完成进度
function KeyTasksCard({ loaded, keyTasks, pendingCount, doneToday, goals, onToggle, onAdd, onViewAll }) {
  const { colors } = useTheme()
  const goalTitles = Object.fromEntries(goals.map(g => [g.id, g.title]))
  const total = doneToday + pendingCount
  return (
    <Card eyebrow="今日重点" title="关键任务" links={[{ label: "+ 新增", onClick: onAdd }, { label: "查看全部", onClick: onViewAll }]}>
      {loaded && keyTasks.length === 0 && <Empty>没有待办了，可以点「+ 新增」加一条</Empty>}
      {keyTasks.map((t, i) => {
        const overdue = isOverdue(t)
        const meta = [goalTitles[t.goal_id], t.estimate_minutes ? `${t.estimate_minutes} 分钟` : null, t.due_at ? `截止 ${formatShort(t.due_at)}${overdue ? "（已延期）" : ""}` : null].filter(Boolean)
        return (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: i < keyTasks.length - 1 ? `1px solid ${colors.borderLight}` : "none" }}>
            <input type="checkbox" checked={false} onChange={() => onToggle(t)} aria-label={`完成：${t.title}`} style={{ width: 18, height: 18, accentColor: colors.ink, cursor: "pointer", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>{t.title}</div>
              {meta.length > 0 && <div style={{ fontSize: 12, color: overdue ? colors.dangerInk : colors.textMuted, marginTop: 3 }}>{meta.join(" · ")}</div>}
            </div>
            <Badge tone={PRIORITY_TONE[t.priority] ?? "neutral"}>{PRIORITY_LABEL[t.priority] ?? "中"}</Badge>
          </div>
        )
      })}
      <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12.5, color: colors.textMuted, whiteSpace: "nowrap" }}>今天完成 {doneToday} / {total}</span>
        <div style={{ flex: 1 }}><ProgressBar percent={total ? (doneToday / total) * 100 : 0} height={4} /></div>
      </div>
    </Card>
  )
}

// 今日安排：今天的提醒 + 今天到期的任务，按时间排。最近一个还没到点的高亮成"下一项"，已经过点的变灰
function ScheduleCard({ loaded, tasks, reminders, onViewAll }) {
  const { colors } = useTheme()
  const now = new Date()
  const items = [
    ...reminders.filter(r => isToday(r.remind_at)).map(r => ({ key: `r${r.id}`, at: new Date(r.remind_at), title: r.message, kind: "提醒" })),
    ...tasks.filter(t => isToday(t.due_at)).map(t => ({ key: `t${t.id}`, at: new Date(t.due_at), title: t.title, kind: t.estimate_minutes ? `任务 · ${t.estimate_minutes} 分钟` : "任务截止" })),
  ].sort((a, b) => a.at - b.at)
  const next = items.find(i => i.at >= now)
  const rest = items.filter(i => i !== next)
  const minutesLeft = next ? Math.round((next.at - now) / 60000) : 0
  const leftText = minutesLeft < 60 ? `还有 ${minutesLeft} 分钟` : `还有 ${Math.floor(minutesLeft / 60)} 小时${minutesLeft % 60 ? ` ${minutesLeft % 60} 分` : ""}`

  return (
    <Card eyebrow="今日安排" title="当前与下一项" links={[{ label: "全部提醒", onClick: onViewAll }]}>
      {loaded && items.length === 0 && (
        <Empty>今天没有定时的安排。给提醒或任务的截止时间设在今天，就会出现在这里</Empty>
      )}
      {next && (
        <div style={{ background: colors.neutralSoft, borderLeft: `3px solid ${colors.text}`, borderRadius: 4, padding: "12px 16px", marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: colors.textSecondary }}>
            <span>{timeOf(next.at)} · {next.kind}</span>
            <span style={{ color: colors.ink }}>{leftText}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginTop: 6 }}>{next.title}</div>
        </div>
      )}
      {rest.map((i, idx) => {
        const past = i.at < now
        return (
          <div key={i.key} style={{ display: "flex", alignItems: "baseline", gap: 16, padding: "11px 0", borderBottom: idx < rest.length - 1 ? `1px solid ${colors.borderLight}` : "none", opacity: past ? 0.5 : 1 }}>
            <span style={{ fontSize: 15, color: colors.text, width: 48, flexShrink: 0 }}>{timeOf(i.at)}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title}</span>
            <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>{past ? "已过" : i.kind}</span>
          </div>
        )
      })}
    </Card>
  )
}

// 目标与下一里程碑：顶层目标排成一行小卡片（最多三个，不折行，免得把旁边的卡片撑高），点进目标页
function GoalsCard({ loaded, goals, onOpen }) {
  const { colors } = useTheme()
  const order = { phase: 0, month: 1, week: 2 }
  const roots = goals.filter(g => g.parent_id == null).sort((a, b) => order[a.tier] - order[b.tier]).slice(0, 3)
  return (
    <Card eyebrow="当前阶段" title="目标与下一里程碑" links={[{ label: "规划中心", onClick: onOpen }]}>
      {loaded && roots.length === 0 && <Empty>还没有目标，去「规划中心」建一个</Empty>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(roots.length, 1)}, minmax(0, 1fr))`, gap: 10 }}>
        {roots.map(g => (
          <button
            key={g.id}
            onClick={onOpen}
            style={{ textAlign: "left", fontFamily: "inherit", cursor: "pointer", background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderLeft: `3px solid ${colors.ink}`, borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", minHeight: 150 }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, lineHeight: 1.35 }}>{g.title}</div>
            {g.description && (
              <div style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 6, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{g.description}</div>
            )}
            <div style={{ marginTop: "auto", paddingTop: 12 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: colors.text, marginBottom: 6 }}>{g.progress}%</div>
              <ProgressBar percent={g.progress} height={4} />
            </div>
          </button>
        ))}
      </div>
    </Card>
  )
}

// "9/22 – 9/28"
function weekRange(monday) {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return `${monday.getMonth() + 1}/${monday.getDate()} – ${sunday.getMonth() + 1}/${sunday.getDate()}`
}

// 本周概览：从周一算起完成了几项任务、写了几天日记、完成的任务累计预计时长；底部一键生成周复盘
function WeekCard({ tasks, journal, onReview }) {
  const { colors, buttonStyle } = useTheme()
  const since = startOfWeek()
  const doneThisWeek = tasks.filter(t => t.done && t.updated_at && new Date(t.updated_at) >= since)
  const journalDays = new Set(
    journal.filter(n => n.created_at && new Date(n.created_at) >= since && !n.title?.startsWith("周复盘")).map(n => n.created_at.slice(0, 10))
  ).size
  const minutes = doneThisWeek.reduce((sum, t) => sum + (t.estimate_minutes || 0), 0)
  const cells = [
    { value: doneThisWeek.length, label: "完成任务" },
    { value: journalDays, label: "写日记（天）" },
    { value: formatMinutes(minutes), label: "累计时长" },
  ]
  return (
    <Card eyebrow="本周 · 从周一算起" title="本周概览" extra={<span style={{ fontSize: 13, color: colors.textMuted }}>{weekRange(since)}</span>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
        {cells.map(c => (
          <div key={c.label} style={{ background: colors.neutralSoft, borderRadius: 6, padding: "12px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>{c.value}</div>
            <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>
      <button onClick={onReview} style={{ ...buttonStyle, marginTop: "auto", width: "100%", fontWeight: 500 }}>生成本周复盘</button>
    </Card>
  )
}

export default WorkbenchPanel
