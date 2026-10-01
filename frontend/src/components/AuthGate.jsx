import { useEffect, useRef, useState } from "react"
import { apiFetch, AUTH_REQUIRED_EVENT } from "../api"
import { useTheme } from "../ThemeContext"
import { PERSONA_NAME } from "../persona"
import { disabledStyle } from "../theme"

// 登录门：启动时问后端 /auth/me 有没有登录，没登录就只显示登录页，整个工作台不挂载（不会先闪一下数据）。
// 用着用着会话过期或者在别的设备被踢下线，任何接口回 401 都会广播 AUTH_REQUIRED_EVENT，这里收到就切回登录页
function AuthGate({ children }) {
  const { colors } = useTheme()
  const [state, setState] = useState("checking")   // checking | in | out | error

  const check = () => apiFetch("/auth/me")
    .then(me => setState(me.authenticated ? "in" : "out"))
    .catch(() => setState("error"))
  const retry = () => {
    setState("checking")
    check()
  }

  useEffect(() => {
    apiFetch("/auth/me")
      .then(me => setState(me.authenticated ? "in" : "out"))
      .catch(() => setState("error"))
    const onRequired = () => setState("out")
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired)
  }, [])

  if (state === "in") return children
  return (
    <div style={{ minHeight: "100vh", background: colors.pageBg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      {state === "checking" && <div style={{ color: colors.textMuted, fontSize: 14 }}>加载中…</div>}
      {state === "error" && (
        <div style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
          连不上服务器
          <div><button onClick={retry}style={{ marginTop: 10, border: "none", background: "none", color: colors.ink, cursor: "pointer", fontSize: 14 }}>重试</button></div>
        </div>
      )}
      {state === "out" && <LoginCard onSuccess={() => setState("in")} />}
    </div>
  )
}

function LoginCard({ onSuccess }) {
  const { colors, inputStyle, primaryButtonStyle, panelCardStyle } = useTheme()
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch("/auth/login", { method: "POST", body: { password } })
      onSuccess()
    } catch (err) {
      setError(err.message)
      setPassword("")
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ ...panelCardStyle, width: "100%", maxWidth: 360, padding: "32px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: colors.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>{PERSONA_NAME}</div>
          <div style={{ fontSize: 12.5, color: colors.textMuted }}>个人工作台</div>
        </div>
      </div>
      <label htmlFor="login-password" style={{ display: "block", fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}>密码</label>
      <input
        id="login-password"
        ref={inputRef}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
      />
      {error && <div role="alert" style={{ fontSize: 13, color: colors.danger, marginTop: 8 }}>{error}</div>}
      <button
        type="submit"
        disabled={!password || submitting}
        style={{ ...primaryButtonStyle, width: "100%", marginTop: 16, padding: "9px 0", ...(!password || submitting ? disabledStyle : {}) }}
      >
        {submitting ? "登录中…" : "登录"}
      </button>
    </form>
  )
}

export default AuthGate
