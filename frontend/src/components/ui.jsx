import { useEffect, useRef } from "react"
import { useTheme } from "../ThemeContext"
import { radiusMd } from "../theme"

// 单模块页面共用的小组件，风格参考"个人成长工作台"：灰色小字眉标 + 大号粗体标题 + 右上角近黑主按钮，
// 内容放在白卡片里，进度条和标签用墨绿

// 页面标题区：eyebrow 是标题上方的灰色小字，action 是右侧的主操作按钮
export function PageHeader({ eyebrow, title, action }) {
  const { colors } = useTheme()
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>{eyebrow}</div>}
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: -0.3, color: colors.text }}>{title}</h1>
      </div>
      {action}
    </div>
  )
}

// 小标签。tone 决定颜色：ink 墨绿（类型）、warn 琥珀（迟缓/延期）、danger 红（高优先级）、neutral 灰
export function Badge({ tone = "neutral", children }) {
  const { colors } = useTheme()
  const palette = {
    ink: [colors.inkSoft, colors.ink],
    warn: [colors.warnSoft, colors.warnInk],
    danger: [colors.dangerSoft, colors.dangerInk],
    neutral: [colors.neutralSoft, colors.neutralInk],
  }[tone]
  return (
    <span style={{ display: "inline-block", fontSize: 11.5, lineHeight: "18px", padding: "0 7px", borderRadius: 4, background: palette[0], color: palette[1], whiteSpace: "nowrap", flexShrink: 0 }}>
      {children}
    </span>
  )
}

export function ProgressBar({ percent, height = 6 }) {
  const { colors } = useTheme()
  return (
    <div style={{ height, borderRadius: height / 2, background: colors.neutralSoft, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: "100%", background: colors.ink, borderRadius: height / 2 }} />
    </div>
  )
}

// 通用弹窗：新增/编辑任务和目标都用它。Esc 或点遮罩关闭，打开时焦点落在第一个输入框
export function Modal({ title, onClose, children, footer, width = 460 }) {
  const { colors } = useTheme()
  const bodyRef = useRef(null)

  useEffect(() => {
    bodyRef.current?.querySelector("input, textarea, select")?.focus()
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{ width, maxWidth: "100%", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: colors.cardBg, borderRadius: radiusMd, boxShadow: "0 12px 40px rgba(0,0,0,0.24)", padding: "20px 22px 18px" }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: colors.text, marginBottom: 16 }}>{title}</div>
        <div ref={bodyRef} style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
        {footer && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
  )
}

// 弹窗里的一个表单项：上面标签，下面控件。
// 里面是一组按钮（比如优先级的分段选择）时传 group：用 div 而不是 label，
// 不然点标签文字会被浏览器转成点击组里第一个按钮
export function Field({ label, hint, group = false, children }) {
  const { colors } = useTheme()
  const Tag = group ? "div" : "label"
  return (
    <Tag role={group ? "group" : undefined} aria-label={group ? label : undefined} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12.5, color: colors.textSecondary }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: colors.textMuted }}>{hint}</span>}
    </Tag>
  )
}

// 分段选择（优先级 高/中/低 这种少量选项），比下拉框点起来快
export function Segmented({ value, options, onChange }) {
  const { colors } = useTheme()
  return (
    <div role="radiogroup" style={{ display: "flex", gap: 6 }}>
      {options.map(o => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1, padding: "6px 0", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "inherit",
              border: `1px solid ${active ? colors.btnDark : colors.border}`,
              background: active ? colors.btnDark : colors.cardBg,
              color: active ? colors.btnDarkText : colors.text,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
