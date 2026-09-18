import { useState, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import { API, authHeaders } from "./api"
import WorkbenchPanel from "./components/WorkbenchPanel"
import ModulePage from "./components/ModulePage"
import TaskPanel from "./components/TaskPanel"
import NotePanel from "./components/NotePanel"
import ReminderPanel from "./components/ReminderPanel"
import ReminderBanner from "./components/ReminderBanner"
import { useTheme } from "./ThemeContext"
import { moduleAccents, railIconColor } from "./theme"
import { ModuleIcon } from "./icons"

const iconBtnStyle = {
  width: 28, height: 28, borderRadius: 7, border: "none", background: "none",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
}

// 图标栏的导航项：总览 + 四个模块，点哪个主区域就切到哪个视图
const NAV_ITEMS = [
  { key: "overview", label: "总览", icon: "overview", accent: null },
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
  const [messages, setMessages] = useState([])          // 当前对话消息
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [workbenchRefreshKey, setWorkbenchRefreshKey] = useState(0)  // agent 用过工具后 +1，触发工作台面板刷新
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // 页面加载时获取所有会话
  useEffect(() => {
    fetchSessions()
  }, [])

  const fetchSessions = async () => {
    const res = await fetch(`${API}/sessions`, { headers: authHeaders })
    const data = await res.json()
    setSessions(data)
  }

  // 点击会话，加载该会话的消息
  const loadSession = async (sessionId) => {
    setCurrentSession(sessionId)
    setShowHistory(false)
    const res = await fetch(`${API}/sessions/${sessionId}/messages`, { headers: authHeaders })
    const data = await res.json()
    setMessages(data)
  }

  const sendMessage = async (presetText) => {
    const text = presetText ?? input
    if (!text.trim()) return

    const newMessages = [...messages, { role: "user", content: text }]
    setMessages(newMessages)
    if (!presetText) setInput("")
    setLoading(true)

    // 先加一条空的 AI 消息占位
    setMessages([...newMessages, { role: "assistant", content: "" }])

    const res = await fetch(`${API}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        session_id: currentSession,
        messages: newMessages
      })
    })

    if (!res.ok) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: "assistant", content: "[请求失败，请稍后再试]" }
        return updated
      })
      setLoading(false)
      return
    }

    const newSessionId = res.headers.get("X-Session-Id")
    const toolUsed = res.headers.get("X-Tool-Used") === "true"

    // 读取流式响应
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullReply = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      fullReply += chunk

      // 每收到一块就更新最后一条 AI 消息
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: "assistant", content: fullReply }
        return updated
      })
    }

    // 流结束后刷新历史，并记录新会话 id
    if (!currentSession) {
      if (newSessionId) setCurrentSession(Number(newSessionId))
      fetchSessions()
    }
    // agent 这一轮调用过工具（比如改了任务/笔记/提醒），刷新工作台面板
    if (toolUsed) {
      setWorkbenchRefreshKey(k => k + 1)
    }
    setLoading(false)
  }

  // 导出对话
  const exportChat = (format) => {
    if (messages.length === 0) return

    let content = ""

    if (format === "txt") {
      content = messages.map(msg =>
        `${msg.role === "user" ? "我" : "AI"}：${msg.content}`
      ).join("\n\n")
    } else {
      content = messages.map(msg =>
        msg.role === "user"
          ? `**我：** ${msg.content}`
          : `**AI：** ${msg.content}`
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
                <span style={{ fontSize: 14, fontWeight: 600, marginRight: "auto", color: colors.text }}>AI 助手</span>
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
              {messages.map((msg, i) => (
                <div key={i} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
                  <span style={{
                    display: "inline-block",
                    background: msg.role === "user" ? colors.primary : colors.assistantBubble,
                    color: msg.role === "user" ? colors.primaryText : colors.text,
                    padding: "8px 12px",
                    borderRadius: msg.role === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                  }}>
                    {msg.role === "assistant"
                      ? <ReactMarkdown>{msg.content}</ReactMarkdown>
                      : msg.content
                    }
                  </span>
                </div>
              ))}
              {loading && <div style={{ color: colors.textMuted, fontSize: 13 }}>AI 正在回复...</div>}
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
