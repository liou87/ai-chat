import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { API, authHeaders, apiFetch } from "./api"
import WorkbenchPanel from "./components/WorkbenchPanel"
import ModulePage from "./components/ModulePage"
import TaskPanel from "./components/TaskPanel"
import GoalPanel from "./components/GoalPanel"
import NotePanel from "./components/NotePanel"
import ReminderPanel from "./components/ReminderPanel"
import HotTopicsPanel from "./components/HotTopicsPanel"
import AssistantAvatar from "./components/AssistantAvatar"
import { PERSONA_NAME } from "./persona"
import ReminderBanner from "./components/ReminderBanner"
import { useTheme } from "./ThemeContext"
import { moduleAccents, railIconColor } from "./theme"
import { ModuleIcon } from "./icons"
import { isSubmitEnter } from "./keyboard"
import { useConfirm } from "./confirm"
import { dayBucket } from "./datetime"
import { useWindowWidth } from "./hooks"

const iconBtnStyle = {
  width: 28, height: 28, borderRadius: 7, border: "none", background: "none",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
}

// 从 useChat 的 UIMessage.parts 里拼出纯文本，导出对话用得到
const messageText = (msg) => msg.parts.filter(p => p.type === "text").map(p => p.text).join("")

// 工具名 -> 中文动作，聊天里显示"正在新建任务…/已新建任务"，不直接把英文函数名露给用户。
// 跟后端 services/tools/ 下注册的工具一一对应，新增工具时这里也要补一条，没补的会退回显示原名。
const TOOL_LABELS = {
  create_goal: "新建目标",
  list_goals: "查看目标",
  update_goal_progress: "更新目标进度",
  create_task: "新建任务",
  list_tasks: "查看任务",
  complete_task: "完成任务",
  delete_task: "删除任务",
  save_note: "保存笔记",
  search_notes: "搜索笔记",
  sync_notion_notes: "同步 Notion",
  add_journal_entry: "写日记",
  get_weekly_review: "生成周复盘",
  set_reminder: "设置提醒",
  list_reminders: "查看提醒",
  cancel_reminder: "取消提醒",
  web_search: "联网搜索",
}

function toolStatusText(part) {
  const name = part.type.slice(5)
  const label = TOOL_LABELS[name] ?? name
  if (part.state === "output-error") return `${label}失败`
  if (part.state === "output-available") return `已${label}`
  return `正在${label}…`
}

// 离底部多近算"在底部"：在底部时新内容自动跟随，往上翻了就不再强行拉回去
const STICK_THRESHOLD = 40
const WEEKLY_REVIEW_PROMPT = "请帮我生成这周的复盘总结"
const SESSION_BUCKETS = ["今天", "昨天", "最近 7 天", "更早"]

// ---- 布局尺寸 ----
// 窗口窄于这个宽度，侧栏收成只有图标（悬停看名字），给主区域和聊天多让点地方
const RAIL_COMPACT_BELOW = 1280
const RAIL_WIDTH = 176
const RAIL_WIDTH_COMPACT = 60
const COLLAPSE_HANDLE_WIDTH = 18
// 聊天面板可以拖动左边缘调宽，宽度记在本机浏览器里（只是个人偏好，存不进去也不影响使用）
const CHAT_WIDTH_DEFAULT = 380
const CHAT_WIDTH_MIN = 300
const CHAT_WIDTH_MAX = 640
const MAIN_MIN_WIDTH = 420   // 拖宽聊天时主区域至少留这么宽
const CHAT_WIDTH_KEY = "ai-chat-chat-width"

function loadChatWidth() {
  try {
    const saved = Number(localStorage.getItem(CHAT_WIDTH_KEY))
    if (saved >= CHAT_WIDTH_MIN && saved <= CHAT_WIDTH_MAX) return saved
  } catch {
    // localStorage 不可用就用默认宽度
  }
  return CHAT_WIDTH_DEFAULT
}

function saveChatWidth(width) {
  try {
    localStorage.setItem(CHAT_WIDTH_KEY, String(width))
  } catch {
    // 存不进去就算了，只是下次打开回到默认宽度
  }
}
const INPUT_MAX_HEIGHT = 160

// 图标栏的导航项：总览 + 六个模块，点哪个主区域就切到哪个视图
const NAV_ITEMS = [
  { key: "overview", label: "总览", icon: "overview", accent: null },
  { key: "goals", label: "目标", icon: "goals", accent: moduleAccents.goals },
  { key: "tasks", label: "任务", icon: "tasks", accent: moduleAccents.tasks },
  { key: "notes", label: "笔记", icon: "notes", accent: moduleAccents.notes },
  { key: "journal", label: "日记", icon: "journal", accent: moduleAccents.journal },
  { key: "reminders", label: "提醒", icon: "reminders", accent: moduleAccents.reminders },
  { key: "hotTopics", label: "热点", icon: "hotTopics", accent: moduleAccents.hotTopics },
]

function App() {
  const { colors, inputStyle, isDark, toggleTheme } = useTheme()
  const confirm = useConfirm()
  const [activeView, setActiveView] = useState("overview")  // overview | goals | tasks | notes | journal | reminders | hotTopics
  const [sessions, setSessions] = useState([])          // 会话列表
  const [sessionsError, setSessionsError] = useState(null)
  const [currentSession, setCurrentSession] = useState(null)  // 当前会话id
  const [input, setInput] = useState("")
  const [workbenchRefreshKey, setWorkbenchRefreshKey] = useState(0)  // agent 用过工具后 +1，触发工作台面板刷新
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [openMenu, setOpenMenu] = useState(null)  // null | "history" | "more"，聊天头部的两个下拉
  const [historyLoadError, setHistoryLoadError] = useState(null)
  const [chatNotice, setChatNotice] = useState(null)  // 聊天区底部的一行状态，比如"周复盘已存入日记"

  // ---- 布局：侧栏窄屏收起、聊天面板拖动调宽 ----
  const windowWidth = useWindowWidth()
  const railCompact = windowWidth < RAIL_COMPACT_BELOW
  const railWidth = railCompact ? RAIL_WIDTH_COMPACT : RAIL_WIDTH
  const [chatWidth, setChatWidth] = useState(loadChatWidth)
  const [resizingChat, setResizingChat] = useState(false)
  // 实际宽度还要受窗口限制：窗口变窄时自动收窄，保证主区域至少留 MAIN_MIN_WIDTH
  const maxChatWidthForWindow = Math.min(CHAT_WIDTH_MAX, windowWidth - railWidth - COLLAPSE_HANDLE_WIDTH - MAIN_MIN_WIDTH)
  const effectiveChatWidth = Math.max(CHAT_WIDTH_MIN, Math.min(chatWidth, maxChatWidthForWindow))
  const clampChatWidth = (w) => Math.round(Math.max(CHAT_WIDTH_MIN, Math.min(w, maxChatWidthForWindow)))

  const onResizeStart = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizingChat(true)
  }
  const onResizeMove = (e) => {
    if (!resizingChat) return
    setChatWidth(clampChatWidth(window.innerWidth - e.clientX))
  }
  const onResizeEnd = () => {
    if (!resizingChat) return
    setResizingChat(false)
    saveChatWidth(chatWidth)
  }
  // 键盘也能调：左右方向键每次 20px，双击或 Home 恢复默认
  const onResizeKey = (e) => {
    const step = e.key === "ArrowLeft" ? 20 : e.key === "ArrowRight" ? -20 : 0
    if (step) {
      e.preventDefault()
      const next = clampChatWidth(effectiveChatWidth + step)
      setChatWidth(next)
      saveChatWidth(next)
    } else if (e.key === "Home") {
      resetChatWidth()
    }
  }
  const resetChatWidth = () => {
    setChatWidth(CHAT_WIDTH_DEFAULT)
    saveChatWidth(CHAT_WIDTH_DEFAULT)
  }

  const fetchSessions = async () => {
    try {
      setSessions(await apiFetch("/sessions"))
      setSessionsError(null)
    } catch (e) {
      setSessionsError(e.message)
    }
  }

  // useChat 的 onData 回调是 hook 初始化时捕获的闭包，用 ref 存 currentSession 才能在回调里读到最新值
  const currentSessionRef = useRef(null)
  useEffect(() => { currentSessionRef.current = currentSession }, [currentSession])
  // 这一轮是不是"生成本周复盘"：是的话回复完整结束后把正文存进日记。onFinish 同样是初始化时捕获的闭包，用 ref
  const pendingReviewSaveRef = useRef(false)

  // transport 只创建一次：请求体按后端 /api/chat/stream 已有的 {session_id, messages: [{role, content}]}
  // 格式重新拼装，不用 AI SDK 默认的 UIMessage 请求体，后端完全不用感知这次前端改造。
  // prepareSendMessagesRequest 只在真正发请求时才会被调用（不在渲染过程中执行），这里读 ref 是安全的，
  // 跟 AI SDK 官方文档里 headers: () => getToken() 是同一个道理；eslint 的 react-hooks/refs 规则会顺着
  // 变量追踪到 ref，不管它有没有嵌在没被立即调用的回调里，所以这里手动豁免一下。
  // eslint-disable-next-line react-hooks/refs
  const transport = useMemo(() => new DefaultChatTransport({
    api: `${API}/chat/stream`,
    headers: authHeaders,
    prepareSendMessagesRequest: ({ messages: uiMessages }) => ({
      headers: authHeaders,
      body: {
        session_id: currentSessionRef.current,
        messages: uiMessages.map(m => ({ role: m.role, content: messageText(m) })),
      },
    }),
  }), [])

  // 后端按 AI SDK 的 UI Message Stream 协议推事件：文字是逐块的 text-delta，工具调用是
  // tool-input-available/tool-output-available，session id 和"这轮有没有用到工具"走自定义的 data 事件
  const { messages, sendMessage: sendChatMessage, setMessages, status, stop } = useChat({
    transport,
    onData: (part) => {
      if (part.type === "data-session") {
        const sid = part.data.sessionId
        if (currentSessionRef.current == null) {
          setCurrentSession(sid)
          fetchSessions()
        }
      } else if (part.type === "data-title") {
        // 新会话第一轮结束后后端用 AI 起了标题，直接改列表里那一条
        const { sessionId, title } = part.data
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s))
      } else if (part.type === "data-meta" && part.data.toolUsed) {
        setWorkbenchRefreshKey(k => k + 1)
      }
    },
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      if (!pendingReviewSaveRef.current) return
      pendingReviewSaveRef.current = false
      const text = messageText(message).trim()
      // 中途停止、出错的不存，免得存进去半截复盘
      if (isAbort || isError || isDisconnect || !text) return
      apiFetch("/notes/weekly-review", { method: "POST", body: { content: text } })
        .then(note => {
          setChatNotice({ text: `周复盘已存入日记（${note.title}）`, isError: false })
          setWorkbenchRefreshKey(k => k + 1)
        })
        .catch(e => setChatNotice({ text: `周复盘保存失败：${e.message}`, isError: true }))
    },
  })
  const loading = status === "submitted" || status === "streaming"

  // 页面加载时获取所有会话
  useEffect(() => {
    fetchSessions()
  }, [])

  // 今日简报只在这里请求一次，总览的简报卡片和聊天开场白共用这一份，
  // 避免首次打开时两处同时请求、在定时任务还没跑的情况下触发两次生成
  const [digest, setDigest] = useState({ data: null, loading: true, error: null })
  const loadDigest = () => {
    setDigest(d => ({ ...d, loading: true, error: null }))
    apiFetch("/digest/today")
      .then(data => setDigest({ data, loading: false, error: null }))
      .catch(e => setDigest({ data: null, loading: false, error: e.message }))
  }
  useEffect(loadDigest, [])

  // 手动重新生成简报：按现在的任务/提醒重写一份，覆盖今天那条
  const regenerateDigest = async () => {
    if (!(await confirm({ title: "重新生成今日简报", message: "会按现在的任务和提醒重新写一份，覆盖今天已有的简报，消耗一次 DeepSeek 调用。", confirmText: "重新生成" }))) return
    setDigest(d => ({ ...d, loading: true, error: null }))
    try {
      setDigest({ data: await apiFetch("/digest/today/regenerate", { method: "POST" }), loading: false, error: null })
    } catch (e) {
      setDigest(d => ({ ...d, loading: false, error: e.message }))
    }
  }

  // 简报当成知行的开场白显示——只是展示层的东西，不进 useChat 的真实消息状态，不会被当成对话历史发给后端
  const digestGreeting = digest.data?.content || null
  const displayMessages = useMemo(() => (
    messages.length === 0 && digestGreeting
      ? [{ id: "digest-greeting", role: "assistant", parts: [{ type: "text", text: digestGreeting }] }]
      : messages
  ), [messages, digestGreeting])

  // ---- 聊天区滚动：在底部时跟随新内容，用户往上翻就停住，右下角给个"回到底部" ----
  const scrollRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickToBottomRef.current = true
    setShowJump(false)
  }

  const onChatScroll = () => {
    const el = scrollRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
    stickToBottomRef.current = atBottom
    setShowJump(!atBottom)
  }

  useLayoutEffect(() => {
    if (stickToBottomRef.current) scrollToBottom()
  }, [displayMessages, status, chatCollapsed])

  // ---- 输入框：多行，随内容长高，超过上限后内部滚动 ----
  const inputRef = useRef(null)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`
  }, [input, chatCollapsed])

  const startNewChat = () => {
    stop()
    pendingReviewSaveRef.current = false
    setCurrentSession(null)
    setMessages([])
    setHistoryLoadError(null)
    setChatNotice(null)
    setOpenMenu(null)
  }

  const deleteSession = async (s) => {
    setOpenMenu(null)
    if (!(await confirm({ title: "删除会话", message: `「${s.title}」的全部消息会被删除，无法恢复。` }))) return
    try {
      await apiFetch(`/sessions/${s.id}`, { method: "DELETE" })
      if (currentSession === s.id) startNewChat()
      setSessions(prev => prev.filter(x => x.id !== s.id))
    } catch (e) {
      setChatNotice({ text: `删除会话失败：${e.message}`, isError: true })
    }
  }

  // 历史会话按"今天/昨天/最近 7 天/更早"分组，后端已经按时间倒序
  const groupedSessions = SESSION_BUCKETS
    .map(label => ({ label, items: sessions.filter(s => dayBucket(s.created_at) === label) }))
    .filter(g => g.items.length > 0)

  // 点击会话，加载该会话的消息
  const loadSession = async (sessionId) => {
    stop()
    pendingReviewSaveRef.current = false
    setCurrentSession(sessionId)
    setOpenMenu(null)
    setHistoryLoadError(null)
    setChatNotice(null)
    try {
      const data = await apiFetch(`/sessions/${sessionId}/messages`)
      setMessages(data.map((m, i) => ({
        id: `hist-${sessionId}-${i}`,
        role: m.role,
        parts: [{ type: "text", text: m.content }],
      })))
      stickToBottomRef.current = true
    } catch (e) {
      setMessages([])
      setHistoryLoadError(e.message)
    }
  }

  const sendMessage = (presetText) => {
    if (loading) return
    const text = presetText ?? input
    if (!text.trim()) return
    if (presetText == null) setInput("")
    setHistoryLoadError(null)
    setChatNotice(null)
    stickToBottomRef.current = true
    sendChatMessage({ text })
  }

  // 导出对话
  const exportChat = (format) => {
    setOpenMenu(null)
    if (messages.length === 0) return

    let content = ""

    if (format === "txt") {
      content = messages.map(msg =>
        `${msg.role === "user" ? "我" : PERSONA_NAME}：${messageText(msg)}`
      ).join("\n\n")
    } else {
      content = messages.map(msg =>
        msg.role === "user"
          ? `**我：** ${messageText(msg)}`
          : `**${PERSONA_NAME}：** ${messageText(msg)}`
      ).join("\n\n---\n\n")
    }

    // 创建下载链接
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `chat-export.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 周复盘走聊天生成，聊天收起时先展开，不然点了按钮什么都看不到
  // 回复完整结束后，onFinish 会把复盘正文存成一条"周复盘 YYYY-Www"日记
  const onRequestWeeklyReview = () => {
    if (loading) return
    setChatCollapsed(false)
    pendingReviewSaveRef.current = true
    sendMessage(WEEKLY_REVIEW_PROMPT)
  }

  // "思考中"只在还没有任何回复内容时显示，文字开始流出来就收起，不跟正文同时挂着
  const lastMessage = messages[messages.length - 1]
  const showThinking = loading && !(lastMessage?.role === "assistant" && lastMessage.parts.some(p => (p.type === "text" && p.text) || p.type.startsWith("tool-")))

  // 单模块页面统一用参考图风格：居中限宽的内容栏、白卡片、墨绿强调色（模块色只留在侧栏）。
  // 任务和目标页标题区右侧的"新增"按钮要打开组件内部的弹窗，所以由组件自己渲染标题区；
  // 其它几页标题区由 ModulePage 统一画。笔记、日记、提醒、热点偏阅读，内容栏窄一点
  const renderMain = () => {
    const ink = colors.ink
    switch (activeView) {
      case "goals":
        return (
          <ModulePage>
            <GoalPanel refreshKey={workbenchRefreshKey} accent={ink} mode="expanded" />
          </ModulePage>
        )
      case "tasks":
        return (
          <ModulePage>
            <TaskPanel refreshKey={workbenchRefreshKey} accent={ink} mode="expanded" />
          </ModulePage>
        )
      case "notes":
        return (
          <ModulePage eyebrow="知识库 · 支持语义搜索" title="笔记" width={860}>
            <NotePanel refreshKey={workbenchRefreshKey} category="note" accent={ink} mode="expanded" />
          </ModulePage>
        )
      case "journal":
        return (
          <ModulePage eyebrow="每日复盘 · 周复盘" title="日记" width={860}>
            <NotePanel
              refreshKey={workbenchRefreshKey}
              category="journal"
              accent={ink}
              mode="expanded"
              onRequestWeeklyReview={onRequestWeeklyReview}
            />
          </ModulePage>
        )
      case "reminders":
        return (
          <ModulePage eyebrow="到期后顶部弹出，并发系统通知" title="提醒" width={860}>
            <ReminderPanel refreshKey={workbenchRefreshKey} accent={ink} mode="expanded" />
          </ModulePage>
        )
      case "hotTopics":
        return (
          <ModulePage eyebrow="AI / agent 领域，每天自动收集一次" title="今日热点" width={860}>
            <HotTopicsPanel />
          </ModulePage>
        )
      default:
        return <WorkbenchPanel refreshKey={workbenchRefreshKey} digest={digest} onRetryDigest={loadDigest} onRegenerateDigest={regenerateDigest} />
    }
  }

  const menuStyle = {
    position: "absolute", top: "100%", right: 8, maxHeight: 320, overflowY: "auto",
    background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
    boxShadow: "0 4px 16px rgba(0,0,0,0.16)", zIndex: 10, padding: 6,
  }
  const menuItemStyle = {
    display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
    padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: colors.text, fontFamily: "inherit",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "sans-serif", background: colors.pageBg, color: colors.text, userSelect: resizingChat ? "none" : undefined, cursor: resizingChat ? "col-resize" : undefined }}>
      <ReminderBanner refreshKey={workbenchRefreshKey} onChange={() => setWorkbenchRefreshKey(k => k + 1)} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* 侧栏：品牌标 + 总览/六模块导航（图标+文字），不用悬停就知道每个入口是什么 + 主题切换 + 头像。
            窗口窄时收成只有图标，文字挪到悬停提示和 aria-label 里 */}
        <nav style={{ width: railWidth, flexShrink: 0, background: colors.railBg, display: "flex", flexDirection: "column", padding: railCompact ? "16px 10px" : "16px 12px", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: railCompact ? "center" : undefined, gap: 9, marginBottom: 18, padding: railCompact ? 0 : "0 4px" }} title={railCompact ? PERSONA_NAME : undefined}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: colors.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            {!railCompact && <span style={{ fontSize: 14.5, fontWeight: 600, color: "#fff" }}>{PERSONA_NAME}</span>}
          </div>

          {NAV_ITEMS.map(item => {
            const active = activeView === item.key
            const activeColor = item.accent ?? colors.primary
            return (
              <button
                key={item.key}
                onClick={() => setActiveView(item.key)}
                aria-current={active ? "page" : undefined}
                aria-label={railCompact ? item.label : undefined}
                title={railCompact ? item.label : undefined}
                style={{
                  width: "100%", height: 36, borderRadius: 8, border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: railCompact ? "center" : undefined, gap: 10, padding: railCompact ? 0 : "0 10px",
                  background: active ? activeColor + "26" : "transparent",
                }}
              >
                <ModuleIcon name={item.icon} color={active ? activeColor : railIconColor} size={16} />
                {!railCompact && <span style={{ fontSize: 13.5, color: active ? "#fff" : railIconColor, fontWeight: active ? 600 : 400 }}>{item.label}</span>}
              </button>
            )
          })}

          <div style={{ flex: 1 }} />
          <button
            onClick={toggleTheme}
            aria-label={railCompact ? (isDark ? "浅色模式" : "深色模式") : undefined}
            title={railCompact ? (isDark ? "浅色模式" : "深色模式") : undefined}
            style={{
              width: "100%", height: 34, borderRadius: 8, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: railCompact ? "center" : undefined, gap: 10, padding: railCompact ? 0 : "0 10px", background: "transparent",
            }}
          >
            {isDark ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={railIconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={railIconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
            {!railCompact && <span style={{ fontSize: 13.5, color: railIconColor }}>{isDark ? "浅色模式" : "深色模式"}</span>}
          </button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: railCompact ? "center" : undefined, gap: 10, padding: railCompact ? "8px 0 0" : "8px 10px 0" }} title={railCompact ? "我的工作台" : undefined}>
            <div style={{ width: 26, height: 26, borderRadius: 13, background: colors.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>我</div>
            {!railCompact && <span style={{ fontSize: 13, color: railIconColor }}>我的工作台</span>}
          </div>
        </nav>

        {/* 主区域：总览网格，或某个模块的宽松全页视图 */}
        {renderMain()}

        {/* 折叠把手 */}
        <button
          onClick={() => setChatCollapsed(c => !c)}
          style={{ width: COLLAPSE_HANDLE_WIDTH, flexShrink: 0, border: "none", borderLeft: `1px solid ${colors.border}`, padding: 0, background: colors.chatBg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          title={chatCollapsed ? "展开聊天" : "收起聊天"}
          aria-label={chatCollapsed ? "展开聊天" : "收起聊天"}
          aria-expanded={!chatCollapsed}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: chatCollapsed ? "rotate(180deg)" : "none" }}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* 右侧聊天面板，固定停靠、可折叠 */}
        {!chatCollapsed && (
          <aside style={{ width: effectiveChatWidth, flexShrink: 0, display: "flex", flexDirection: "column", background: colors.chatBg, position: "relative" }}>
            {/* 左边缘的拖动条：拖动调宽，双击恢复默认宽度 */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整聊天面板宽度"
              aria-valuenow={effectiveChatWidth}
              aria-valuemin={CHAT_WIDTH_MIN}
              aria-valuemax={CHAT_WIDTH_MAX}
              tabIndex={0}
              title="拖动调整宽度，双击恢复默认"
              onPointerDown={onResizeStart}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
              onDoubleClick={resetChatWidth}
              onKeyDown={onResizeKey}
              style={{
                position: "absolute", left: -3, top: 0, bottom: 0, width: 6, zIndex: 20, cursor: "col-resize",
                background: resizingChat ? colors.primary + "55" : "transparent", touchAction: "none",
              }}
            />
            <div style={{ position: "relative", borderBottom: `1px solid ${colors.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
                  <AssistantAvatar active={loading} size={24} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{PERSONA_NAME}</span>
                </div>
                <button onClick={startNewChat} style={iconBtnStyle} title="新对话" aria-label="新对话">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </button>
                <button onClick={() => setOpenMenu(m => m === "history" ? null : "history")} style={iconBtnStyle} title="历史会话" aria-label="历史会话" aria-expanded={openMenu === "history"}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>
                </button>
                <button onClick={() => setOpenMenu(m => m === "more" ? null : "more")} style={iconBtnStyle} title="更多" aria-label="更多" aria-expanded={openMenu === "more"}>
                  <ModuleIcon name="more" color={colors.textSecondary} size={15} strokeWidth={2.4} />
                </button>
              </div>

              {/* 点下拉外面任意位置关闭下拉 */}
              {openMenu && <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />}

              {openMenu === "history" && (
                <div style={{ ...menuStyle, width: 260 }}>
                  {sessionsError && <div style={{ padding: 10, fontSize: 13, color: colors.danger }}>加载失败：{sessionsError}</div>}
                  {!sessionsError && sessions.length === 0 && <div style={{ padding: 10, fontSize: 13, color: colors.textMuted }}>暂无历史会话</div>}
                  {groupedSessions.map(group => (
                    <div key={group.label}>
                      <div style={{ fontSize: 11, color: colors.textMuted, padding: "8px 10px 4px" }}>{group.label}</div>
                      {group.items.map(s => (
                        <SessionItem
                          key={s.id}
                          s={s}
                          active={currentSession === s.id}
                          itemStyle={menuItemStyle}
                          onOpen={() => loadSession(s.id)}
                          onDelete={() => deleteSession(s)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {openMenu === "more" && (
                <div style={{ ...menuStyle, width: 150 }}>
                  {["txt", "md"].map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => exportChat(fmt)}
                      disabled={messages.length === 0}
                      style={{ ...menuItemStyle, cursor: messages.length === 0 ? "not-allowed" : "pointer", color: messages.length === 0 ? colors.textMuted : colors.text }}
                    >
                      导出为 {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div
                ref={scrollRef}
                onScroll={onChatScroll}
                style={{ height: "100%", overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 12, boxSizing: "border-box" }}
              >
                {displayMessages.map((msg) => (
                  <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
                    {msg.parts.map((part, pi) => {
                      if (part.type === "text") {
                        if (!part.text) return null
                        return (
                          <span key={pi} style={{
                            display: "inline-block",
                            background: msg.role === "user" ? colors.primary : colors.assistantBubble,
                            color: msg.role === "user" ? colors.primaryText : colors.text,
                            padding: "8px 12px",
                            borderRadius: msg.role === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                            fontSize: 13.5,
                            lineHeight: 1.5,
                            whiteSpace: msg.role === "user" ? "pre-wrap" : undefined,
                          }}>
                            {msg.role === "assistant"
                              ? <ReactMarkdown>{part.text}</ReactMarkdown>
                              : part.text
                            }
                          </span>
                        )
                      }
                      // 工具调用/结果这类 part 的 type 是 "tool-<工具名>"，只是一个不抢眼的小提示
                      if (part.type.startsWith("tool-")) {
                        return (
                          <span key={pi} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: part.state === "output-error" ? colors.danger : colors.textMuted }}>
                            <ModuleIcon name="tool" color="currentColor" size={11} />
                            {toolStatusText(part)}
                          </span>
                        )
                      }
                      return null
                    })}
                  </div>
                ))}
                {showThinking && <div style={{ color: colors.textMuted, fontSize: 13 }}>{PERSONA_NAME}正在思考…</div>}
                {status === "error" && <div style={{ color: colors.danger, fontSize: 13 }}>请求失败，请稍后再试</div>}
                {historyLoadError && <div style={{ color: colors.danger, fontSize: 13 }}>会话加载失败：{historyLoadError}</div>}
                {chatNotice && <div style={{ color: chatNotice.isError ? colors.danger : colors.textMuted, fontSize: 12.5 }}>{chatNotice.text}</div>}
              </div>

              {showJump && (
                <button
                  onClick={scrollToBottom}
                  aria-label="回到底部"
                  title="回到底部"
                  style={{
                    position: "absolute", right: 16, bottom: 10, width: 30, height: 30, borderRadius: 15,
                    border: `1px solid ${colors.border}`, background: colors.surface, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                  }}
                >
                  <ModuleIcon name="arrowDown" color={colors.textSecondary} size={14} />
                </button>
              )}
            </div>

            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, background: colors.inputRowBg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "6px 6px 6px 12px" }}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (isSubmitEnter(e)) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="输入消息，Shift+Enter 换行"
                  aria-label="输入消息"
                  style={{ ...inputStyle, flex: 1, border: "none", background: "none", padding: "5px 0", resize: "none", lineHeight: 1.45, maxHeight: INPUT_MAX_HEIGHT, boxSizing: "border-box" }}
                />
                {loading ? (
                  <button onClick={stop} title="停止生成" aria-label="停止生成" style={{ width: 30, height: 30, borderRadius: 8, background: colors.text, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    <ModuleIcon name="stop" color={colors.pageBg} size={13} strokeWidth={2.6} />
                  </button>
                ) : (
                  <button
                    onClick={() => sendMessage()}
                    disabled={!input.trim()}
                    title="发送"
                    aria-label="发送"
                    style={{ width: 30, height: 30, borderRadius: 8, background: colors.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() ? "pointer" : "default", opacity: input.trim() ? 1 : 0.45, flexShrink: 0 }}
                  >
                    <ModuleIcon name="send" color="#fff" size={14} strokeWidth={2.3} />
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

// 历史会话里的一条：整行点击打开，悬停/聚焦时右侧出现删除按钮
function SessionItem({ s, active, itemStyle, onOpen, onDelete }) {
  const { colors } = useTheme()
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", borderRadius: 6, background: active ? colors.selectedBg : hover ? colors.inputRowBg : "transparent" }}
    >
      <button onClick={onOpen} style={{ ...itemStyle, flex: 1, minWidth: 0, background: "transparent", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {s.title}
      </button>
      <button
        onClick={onDelete}
        aria-label={`删除会话：${s.title}`}
        title="删除会话"
        style={{ border: "none", background: "none", cursor: "pointer", color: colors.danger, fontSize: 15, lineHeight: 1, padding: "0 10px", opacity: hover ? 1 : 0 }}
      >
        ×
      </button>
    </div>
  )
}

export default App
