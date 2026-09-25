import { useState, useEffect, useRef, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { API, authHeaders } from "./api"
import WorkbenchPanel from "./components/WorkbenchPanel"
import ModulePage from "./components/ModulePage"
import TaskPanel from "./components/TaskPanel"
import GoalPanel from "./components/GoalPanel"
import NotePanel from "./components/NotePanel"
import ReminderPanel from "./components/ReminderPanel"
import AssistantAvatar from "./components/AssistantAvatar"
import { PERSONA_NAME } from "./persona"
import ReminderBanner from "./components/ReminderBanner"
import { useTheme } from "./ThemeContext"
import { moduleAccents, railIconColor } from "./theme"
import { ModuleIcon } from "./icons"

const iconBtnStyle = {
  width: 28, height: 28, borderRadius: 7, border: "none", background: "none",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
}

// 从 useChat 的 UIMessage.parts 里拼出纯文本，导出对话用得到
const messageText = (msg) => msg.parts.filter(p => p.type === "text").map(p => p.text).join("")

// 图标栏的导航项：总览 + 五个模块，点哪个主区域就切到哪个视图
const NAV_ITEMS = [
  { key: "overview", label: "总览", icon: "overview", accent: null },
  { key: "goals", label: "目标", icon: "goals", accent: moduleAccents.goals },
  { key: "tasks", label: "任务", icon: "tasks", accent: moduleAccents.tasks },
  { key: "notes", label: "笔记", icon: "notes", accent: moduleAccents.notes },
  { key: "journal", label: "日记", icon: "journal", accent: moduleAccents.journal },
  { key: "reminders", label: "提醒", icon: "reminders", accent: moduleAccents.reminders },
]

function App() {
  const { colors, inputStyle, isDark, toggleTheme } = useTheme()
  const [activeView, setActiveView] = useState("overview")  // overview | tasks | notes | journal | reminders
  const [sessions, setSessions] = useState([])          // 会话列表
  const [currentSession, setCurrentSession] = useState(null)  // 当前会话id
  const [input, setInput] = useState("")
  const [workbenchRefreshKey, setWorkbenchRefreshKey] = useState(0)  // agent 用过工具后 +1，触发工作台面板刷新
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const fetchSessions = async () => {
    const res = await fetch(`${API}/sessions`, { headers: authHeaders })
    const data = await res.json()
    setSessions(data)
  }

  // useChat 的 onData 回调是 hook 初始化时捕获的闭包，用 ref 存 currentSession 才能在回调里读到最新值
  const currentSessionRef = useRef(null)
  useEffect(() => { currentSessionRef.current = currentSession }, [currentSession])

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
  const { messages, sendMessage: sendChatMessage, setMessages, status } = useChat({
    transport,
    onData: (part) => {
      if (part.type === "data-session") {
        const sid = part.data.sessionId
        if (currentSessionRef.current == null) {
          setCurrentSession(sid)
          fetchSessions()
        }
      } else if (part.type === "data-meta" && part.data.toolUsed) {
        setWorkbenchRefreshKey(k => k + 1)
      }
    },
  })
  const loading = status === "submitted" || status === "streaming"

  // 页面加载时获取所有会话
  useEffect(() => {
    fetchSessions()
  }, [])

  // 点击会话，加载该会话的消息
  const loadSession = async (sessionId) => {
    setCurrentSession(sessionId)
    setShowHistory(false)
    const res = await fetch(`${API}/sessions/${sessionId}/messages`, { headers: authHeaders })
    const data = await res.json()
    setMessages(data.map((m, i) => ({
      id: `hist-${sessionId}-${i}`,
      role: m.role,
      parts: [{ type: "text", text: m.content }],
    })))
  }

  const sendMessage = (presetText) => {
    const text = presetText ?? input
    if (!text.trim()) return
    if (!presetText) setInput("")
    sendChatMessage({ text })
  }

  // 导出对话
  const exportChat = (format) => {
    if (messages.length === 0) return

    let content = ""

    if (format === "txt") {
      content = messages.map(msg =>
        `${msg.role === "user" ? "我" : "AI"}：${messageText(msg)}`
      ).join("\n\n")
    } else {
      content = messages.map(msg =>
        msg.role === "user"
          ? `**我：** ${messageText(msg)}`
          : `**AI：** ${messageText(msg)}`
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

  const onRequestWeeklyReview = () => sendMessage("请帮我生成这周的复盘总结")

  const renderMain = () => {
    switch (activeView) {
      case "goals":
        return (
          <ModulePage iconName="goals" title="目标" accent={moduleAccents.goals}>
            <GoalPanel refreshKey={workbenchRefreshKey} accent={moduleAccents.goals} mode="expanded" />
          </ModulePage>
        )
      case "tasks":
        return (
          <ModulePage iconName="tasks" title="任务" accent={moduleAccents.tasks}>
            <TaskPanel refreshKey={workbenchRefreshKey} accent={moduleAccents.tasks} mode="expanded" />
          </ModulePage>
        )
      case "notes":
        return (
          <ModulePage iconName="notes" title="笔记" accent={moduleAccents.notes}>
            <NotePanel refreshKey={workbenchRefreshKey} category="note" accent={moduleAccents.notes} mode="expanded" />
          </ModulePage>
        )
      case "journal":
        return (
          <ModulePage iconName="journal" title="日记" accent={moduleAccents.journal}>
            <NotePanel
              refreshKey={workbenchRefreshKey}
              category="journal"
              accent={moduleAccents.journal}
              mode="expanded"
              onRequestWeeklyReview={onRequestWeeklyReview}
            />
          </ModulePage>
        )
      case "reminders":
        return (
          <ModulePage iconName="reminders" title="提醒" accent={moduleAccents.reminders}>
            <ReminderPanel refreshKey={workbenchRefreshKey} accent={moduleAccents.reminders} mode="expanded" />
          </ModulePage>
        )
      default:
        return <WorkbenchPanel refreshKey={workbenchRefreshKey} onRequestWeeklyReview={onRequestWeeklyReview} />
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "sans-serif", background: colors.pageBg, color: colors.text }}>
      <ReminderBanner refreshKey={workbenchRefreshKey} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* 图标栏：品牌标 + 总览/四模块导航 + 主题切换 + 头像 */}
        <div style={{ width: 56, flexShrink: 0, background: colors.railBg, display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", gap: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: colors.primary, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>

          {NAV_ITEMS.map(item => {
            const active = activeView === item.key
            const activeColor = item.accent ?? colors.primary
            return (
              <button
                key={item.key}
                onClick={() => setActiveView(item.key)}
                title={item.label}
                style={{
                  width: 36, height: 36, borderRadius: 10, border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: active ? activeColor + "26" : "transparent",
                }}
              >
                <ModuleIcon name={item.icon} color={active ? activeColor : railIconColor} size={17} />
              </button>
            )
          })}

          <div style={{ flex: 1 }} />
          <button
            onClick={toggleTheme}
            title={isDark ? "切换到浅色模式" : "切换到深色模式"}
            style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            {isDark ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c8cad4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c8cad4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
          </button>
          <div style={{ width: 30, height: 30, borderRadius: 15, background: colors.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, marginTop: 10 }}>我</div>
        </div>

        {/* 主区域：总览网格，或某个模块的宽松全页视图 */}
        {renderMain()}

        {/* 折叠把手 */}
        <div
          onClick={() => setChatCollapsed(c => !c)}
          style={{ width: 18, flexShrink: 0, borderLeft: `1px solid ${colors.border}`, background: colors.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          title={chatCollapsed ? "展开聊天" : "收起聊天"}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: chatCollapsed ? "rotate(180deg)" : "none" }}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>

        {/* 右侧聊天面板，固定停靠、可折叠 */}
        {!chatCollapsed && (
          <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", background: colors.surface }}>
            <div style={{ position: "relative", borderBottom: `1px solid ${colors.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
                  <AssistantAvatar active={loading} size={24} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{PERSONA_NAME}</span>
                </div>
                <button onClick={() => { setCurrentSession(null); setMessages([]); setShowHistory(false) }} style={iconBtnStyle} title="新对话">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
                <button onClick={() => setShowHistory(h => !h)} style={iconBtnStyle} title="历史会话">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>
                </button>
              </div>
              {showHistory && (
                <div style={{ position: "absolute", top: "100%", right: 8, width: 260, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.16)", zIndex: 10, padding: 6 }}>
                  {sessions.length === 0 && <div style={{ padding: 10, fontSize: 13, color: colors.textMuted }}>暂无历史会话</div>}
                  {sessions.map(s => (
                    <div
                      key={s.id}
                      onClick={() => loadSession(s.id)}
                      style={{
                        padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: colors.text,
                        background: currentSession === s.id ? colors.selectedBg : "transparent",
                      }}
                    >
                      {s.title}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map((msg) => (
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
                        <span key={pi} style={{ fontSize: 11, color: colors.textMuted }}>
                          🔧 调用了 {part.type.slice(5)}
                        </span>
                      )
                    }
                    return null
                  })}
                </div>
              ))}
              {loading && <div style={{ color: colors.textMuted, fontSize: 13 }}>AI 正在回复...</div>}
              {status === "error" && <div style={{ color: colors.danger, fontSize: 13 }}>请求失败，请稍后再试</div>}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "0 16px" }}>
              <a onClick={() => exportChat("txt")} style={{ fontSize: 12, color: colors.textMuted, cursor: "pointer" }}>导出 TXT</a>
              <a onClick={() => exportChat("md")} style={{ fontSize: 12, color: colors.textMuted, cursor: "pointer" }}>导出 MD</a>
            </div>

            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: colors.inputRowBg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "6px 6px 6px 12px" }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendMessage()}
                  placeholder="输入消息..."
                  style={{ ...inputStyle, flex: 1, border: "none", background: "none", padding: "4px 0" }}
                />
                <button onClick={() => sendMessage()} style={{ width: 30, height: 30, borderRadius: 8, background: colors.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
