// 浅色模式整体偏暖的中性色调（参考 Heptabase 的暖白画布），不用刺眼的纯白/纯黑，
// pageBg 和 surface 也拉开一点层次，避免"整个界面全是同一种白"的单调感
export const lightColors = {
  // 品牌色：墨绿，跟进度条、今日建议横幅同一套（侧栏图标、头像、你的消息气泡、发送按钮都用它）
  primary: "#2f5d50",
  primaryText: "#ffffff",
  border: "#e6e0d6",
  borderLight: "#efe9dd",
  textMuted: "#9b9488",
  textSecondary: "#6b655c",
  text: "#2b2a28",
  danger: "#d64545",
  warningBg: "#fff3cd",
  warningBorder: "#ffe69c",
  warningText: "#856404",
  surface: "#fdfbf8",
  pageBg: "#f6f4ef",
  chatBg: "#faf7f2",
  railBg: "#181a23",
  assistantBubble: "#eee7da",
  inputRowBg: "#f5f1ea",
  selectedBg: "#e4eee9",
  // 单模块页面的配色（参考图风格）：白卡片、近黑主按钮、墨绿进度条和标签，模块色只留在侧栏
  cardBg: "#ffffff",
  cardBorder: "#e8e4dc",
  ink: "#2f5d50",
  inkSoft: "#e4eee9",
  btnDark: "#1d1f23",
  btnDarkText: "#ffffff",
  warnSoft: "#f7ecd6",
  warnInk: "#8a5a12",
  neutralSoft: "#eeebe5",
  neutralInk: "#6b655c",
  dangerSoft: "#f8e4e1",
  dangerInk: "#a33a2e",
}

export const darkColors = {
  // 深色模式下的墨绿提亮一档，气泡里的白字还能看清（ink 那个更亮的值是给深底上的文字/进度条用的）
  primary: "#3d7563",
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
  chatBg: "#1c1d24",
  railBg: "#181a23",
  assistantBubble: "#262730",
  inputRowBg: "#23242c",
  selectedBg: "#1f3a33",
  cardBg: "#1c1d24",
  cardBorder: "#2c2e37",
  ink: "#7fb5a3",
  inkSoft: "#1f3a33",
  btnDark: "#ececec",
  btnDarkText: "#15161b",
  warnSoft: "#3d3419",
  warnInk: "#e8c46a",
  neutralSoft: "#2a2c35",
  neutralInk: "#a6a8b3",
  dangerSoft: "#3d2220",
  dangerInk: "#f0a097",
}

// 四个模块的识别色，明暗主题下保持不变——都是中等饱和度，在浅色/深色卡片背景上都读得清楚
export const moduleAccents = {
  goals: "#e11d48",
  tasks: "#3b82f6",
  notes: "#8b5cf6",
  journal: "#f59e0b",
  reminders: "#0d9488",
  hotTopics: "#f97316",
}

// 图标栏本身固定深色（不跟随明暗主题切换），未激活图标用这个中性灰
export const railIconColor = "#9a9db0"

// 条件不满足（比如必填项没填）时按钮的样式：置灰、鼠标显示禁止，配合 disabled 属性用，
// 让人一眼看出"现在点不了"，而不是点了没反应以为按钮坏了
export const disabledStyle = { opacity: 0.45, cursor: "not-allowed" }

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

  // 页面主操作按钮（"+ 新增任务"这类）：近黑实心，深色模式下反过来是近白
  const darkButtonStyle = {
    ...buttonStyle,
    background: colors.btnDark,
    color: colors.btnDarkText,
    border: `1px solid ${colors.btnDark}`,
    fontWeight: 500,
  }

  // 模块页面里的白卡片容器
  const panelCardStyle = {
    background: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: radiusMd,
  }

  return { cardStyle, inputStyle, buttonStyle, primaryButtonStyle, accentButtonStyle, iconButtonStyle, darkButtonStyle, panelCardStyle }
}
