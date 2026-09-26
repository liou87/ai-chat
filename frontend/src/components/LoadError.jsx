import { useTheme } from "../ThemeContext"

// 面板内的加载失败提示，跟"暂无数据"区分开，免得网络一断就让人以为数据丢了
function LoadError({ message, onRetry }) {
  const { colors } = useTheme()
  return (
    <div style={{ fontSize: 13, color: colors.danger, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span>加载失败：{message}</span>
      {onRetry && (
        <button onClick={onRetry} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 13, color: colors.primary }}>
          重试
        </button>
      )}
    </div>
  )
}

export default LoadError
