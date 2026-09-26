import { Component } from "react"

// 全局兜底：任何一个模块渲染时抛异常，都只显示这个提示，不让整页白屏。
// 这里不用 useTheme，因为主题 context 自己出问题时这层也得能显示出来。
class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "sans-serif", color: "#6b655c", background: "#f6f4ef" }}>
        <div style={{ fontSize: 15 }}>页面出错了</div>
        <div style={{ fontSize: 12, color: "#9b9488" }}>{String(this.state.error?.message || this.state.error)}</div>
        <button onClick={() => window.location.reload()} style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #e6e0d6", background: "#fdfbf8", cursor: "pointer" }}>
          刷新页面
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
