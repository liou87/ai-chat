import { useTheme } from "../ThemeContext"
import { ModuleIcon } from "../icons"

// 单模块的宽松全页视图：图标栏点某个模块时展示，跟总览网格共用同一个主区域位置
function ModulePage({ iconName, title, subtitle, accent, extra, children }) {
  const { colors, isDark } = useTheme()
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "28px 32px", background: colors.pageBg, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: accent + (isDark ? "33" : "1f"), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <ModuleIcon name={iconName} color={accent} size={18} />
        </div>
        <span style={{ fontSize: 20, fontWeight: 600, color: colors.text }}>{title}</span>
        {subtitle && <span style={{ fontSize: 13, color: colors.textMuted }}>{subtitle}</span>}
        <div style={{ flex: 1 }} />
        {extra}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {children}
      </div>
    </div>
  )
}

export default ModulePage
