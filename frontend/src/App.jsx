import { useState, useEffect } from "react"
import ReactMarkdown from "react-markdown"

const API = "https://ai-chat-production-5293.up.railway.app/api"

function App() {
  const [sessions, setSessions] = useState([])          // 会话列表
  const [currentSession, setCurrentSession] = useState(null)  // 当前会话id
  const [messages, setMessages] = useState([])          // 当前对话消息
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)

  // 页面加载时获取所有会话
  useEffect(() => {
    fetchSessions()
  }, [])

  const fetchSessions = async () => {
    const res = await fetch(`${API}/sessions`)
    const data = await res.json()
    setSessions(data)
  }

  // 点击会话，加载该会话的消息
  const loadSession = async (sessionId) => {
    setCurrentSession(sessionId)
    const res = await fetch(`${API}/sessions/${sessionId}/messages`)
    const data = await res.json()
    setMessages(data)
  }

 const sendMessage = async () => {
  if (!input.trim()) return

  const newMessages = [...messages, { role: "user", content: input }]
  setMessages(newMessages)
  setInput("")
  setLoading(true)

  // 先加一条空的 AI 消息占位
  setMessages([...newMessages, { role: "assistant", content: "" }])

  const res = await fetch(`${API}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: currentSession,
      messages: newMessages
    })
  })

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

  // 流结束后刷新侧边栏
  if (!currentSession) {
    fetchSessions()
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

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
      
      {/* 侧边栏 */}
      <div style={{ width: 240, borderRight: "1px solid #ddd", padding: 16, overflowY: "auto" }}>
        <button
          onClick={() => { setCurrentSession(null); setMessages([]) }}
          style={{ width: "100%", padding: "8px", marginBottom: 16, borderRadius: 8, cursor: "pointer" }}
        >
          + 新对话
        </button>
        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => loadSession(s.id)}
            style={{
              padding: "8px 12px",
              marginBottom: 8,
              borderRadius: 8,
              cursor: "pointer",
              background: currentSession === s.id ? "#e8f0fe" : "transparent"
            }}
          >
            {s.title}
          </div>
        ))}
      </div>

      {/* 对话区 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 24 }}>
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: 12, textAlign: msg.role === "user" ? "right" : "left" }}>
              <span style={{
                background: msg.role === "user" ? "#0084ff" : "#f0f0f0",
                color: msg.role === "user" ? "white" : "black",
                padding: "8px 12px",
                borderRadius: 16,
                display: "inline-block",
                maxWidth: "70%"
              }}>
                {msg.role === "assistant" 
                ? <ReactMarkdown>{msg.content}</ReactMarkdown>
                  : msg.content
                }
              </span>
            </div>
          ))}
          {loading && <div style={{ color: "#999" }}>AI 正在回复...</div>}
        </div>
        
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            placeholder="输入消息..."
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc" }}
          />
          <button onClick={() => exportChat("txt")} style={{ padding: "8px 12px", borderRadius: 8 }}>
          导出 TXT
          </button>
          <button onClick={() => exportChat("md")} style={{ padding: "8px 12px", borderRadius: 8 }}>
            导出 MD
          </button>
          <button onClick={sendMessage} style={{ padding: "8px 16px", borderRadius: 8 }}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

export default App