export const lightColors = {
  primary: "#0084ff",
  primaryText: "#ffffff",
  border: "#e2e2e2",
  borderLight: "#f0f0f0",
  textMuted: "#999999",
  textSecondary: "#666666",
  text: "#000000",
  danger: "#d64545",
  warningBg: "#fff3cd",
  warningBorder: "#ffe69c",
  warningText: "#856404",
  surface: "#ffffff",
  pageBg: "#f4f5f9",
  railBg: "#181a23",
  assistantBubble: "#f0f0f0",
  inputRowBg: "#fafafa",
  selectedBg: "#e8f0fe",
}

export const darkColors = {
  primary: "#0084ff",
  primaryText: "#ffffff",
  border: "#33353f",
  borderLight: "#2a2c35",
  textMuted: "#7d7f8a",
  textSecondary: "#a6a8b3",
  text: "#ececec",
  danger: "#ef6767",
  warningBg: "#3d3419",
  warningBorder: "#5c4d1f",
  warningText: "#f0c869",
  surface: "#1c1d24",
  pageBg: "#121319",
  railBg: "#181a23",
  assistantBubble: "#262730",
  inputRowBg: "#23242c",
  selectedBg: "#1f3a5c",
}

// 四个模块的识别色，明暗主题下保持不变——都是中等饱和度，在浅色/深色卡片背景上都读得清楚
export const moduleAccents = {
  tasks: "#3b82f6",
  notes: "#8b5cf6",
  journal: "#f59e0b",
  reminders: "#0d9488",
}

// 图标栏本身固定深色（不跟随明暗主题切换），未激活图标用这个中性灰
export const railIconColor = "#9a9db0"

export const radiusSm = 6
export const radiusMd = 12

// 根据当前主题的 colors 生成一套组件样式，ThemeContext 会调用这个并把结果传给各组件
export function buildStyles(colors) {
  const cardStyle = {
    background: colors.surface,
    border: `1px solid ${colors.borderLight}`,
    borderRadius: radiusMd,
    boxShadow: "0 1px 2px rgba(16,24,40,0.06), 0 1px 8px rgba(16,24,40,0.05)",
  }

  const inputStyle = {
    padding: "7px 10px",
    borderRadius: radiusSm,
    border: `1px solid ${colors.border}`,
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
    background: colors.surface,
    color: colors.text,
  }

  const buttonStyle = {
    padding: "7px 12px",
    borderRadius: radiusSm,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    cursor: "pointer",
    fontSize: 14,
  }

  const primaryButtonStyle = {
    ...buttonStyle,
    background: colors.primary,
    color: colors.primaryText,
    border: "none",
  }

  // 淡色轮廓风格：卡片底色 + 强调色描边和文字，不用大面积实心色块，四个模块的"+"按钮统一用这个
  // 注意 border 用完整简写覆盖，不要只改 borderColor —— 混用简写/非简写属性在 React 重渲染时会报警告
  const accentButtonStyle = (accent) => ({
    ...buttonStyle,
    color: accent,
    border: `1px solid ${accent}`,
  })

  const iconButtonStyle = {
    border: "none",
    background: "none",
    cursor: "pointer",
    color: colors.danger,
    fontSize: 16,
    lineHeight: 1,
    padding: 2,
  }

  return { cardStyle, inputStyle, buttonStyle, primaryButtonStyle, accentButtonStyle, iconButtonStyle }
}
