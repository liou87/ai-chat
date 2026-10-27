// 浅色模式整体用偏冷的石绿灰中性色（不是暖米色——暖米色+衬线是 AI 做设计时的默认套路，
// 刻意换成跟"知行"这个成长/笔记主题更贴的调子），pageBg 和 surface 也拉开一点层次，
// 避免"整个界面全是同一种白"的单调感
export const lightColors = {
  // 品牌色：墨绿，跟进度条、今日建议横幅同一套（侧栏图标、头像、你的消息气泡、发送按钮都用它）
  primary: "#2f5d50",
  primaryText: "#ffffff",
  border: "#d3d9d0",
  borderLight: "#e1e5de",
  textMuted: "#8d9086",
  textSecondary: "#5f6358",
  text: "#22221d",
  danger: "#d64545",
  warningBg: "#fff3cd",
  warningBorder: "#ffe69c",
  warningText: "#856404",
  surface: "#f8f9f7",
  pageBg: "#e6e9e4",
  chatBg: "#eceee9",
  // 页面底色上一层很淡的点阵纹理（呼应点阵笔记本），只在大片空白背景上才看得出来，不跟卡片内容抢注意力
  bgPattern: "radial-gradient(circle, rgba(34,34,29,0.09) 1px, transparent 1.3px)",
  // 侧栏用墨绿炭色，跟品牌色同一色相，不再是跟正文割裂的海军蓝；选中项统一用亮一档的墨绿，不按模块变色
  railBg: "#1d2925",
  railAccent: "#7fb5a3",
  assistantBubble: "#e7ebe4",
  inputRowBg: "#eef1ec",
  selectedBg: "#e1ebe5",
  // 单模块页面的配色：白卡片、墨绿主按钮、墨绿进度条和标签。中性色（描边、统计格、标签底）都是冷调，不混暖米色
  cardBg: "#ffffff",
  cardBorder: "#dde2da",
  ink: "#2f5d50",
  inkSoft: "#e3ede8",
  btnDark: "#2f5d50",
  btnDarkText: "#ffffff",
  warnSoft: "#f7ecd6",
  warnInk: "#8a5a12",
  neutralSoft: "#eef1ec",
  neutralInk: "#5c665e",
  dangerSoft: "#f8e4e1",
  dangerInk: "#a33a2e",
}

export const darkColors = {
  // 深色模式的中性色也带一点绿，跟墨绿炭侧栏是同一个色相，不再是偏海军蓝的灰。
  // 深色模式下的墨绿提亮一档，气泡里的白字还能看清（ink 那个更亮的值是给深底上的文字/进度条用的）
  primary: "#3d7563",
  primaryText: "#ffffff",
  border: "#2f3733",
  borderLight: "#282f2c",
  textMuted: "#7f8a85",
  textSecondary: "#a8b1ac",
  text: "#ececec",
  danger: "#ef6767",
  warningBg: "#3d3419",
  warningBorder: "#5c4d1f",
  warningText: "#f0c869",
  surface: "#1b201e",
  pageBg: "#121614",
  chatBg: "#1b201e",
  // 深色模式这次没动，纹理先不加，避免在暗底上看着像噪点
  bgPattern: "none",
  // 跟浅色一样是墨绿炭色，比 pageBg 带一点绿，深色模式下侧栏和正文也能分开
  railBg: "#18211e",
  railAccent: "#7fb5a3",
  assistantBubble: "#252b28",
  inputRowBg: "#222826",
  selectedBg: "#1f3a33",
  cardBg: "#1b201e",
  cardBorder: "#2b3230",
  ink: "#7fb5a3",
  inkSoft: "#1f3a33",
  btnDark: "#3d7563",
  btnDarkText: "#ffffff",
  warnSoft: "#3d3419",
  warnInk: "#e8c46a",
  neutralSoft: "#28302c",
  neutralInk: "#a8b1ac",
  dangerSoft: "#3d2220",
  dangerInk: "#f0a097",
}

// 模块识别色：侧栏已经不用了（选中态统一用 railAccent），只剩 NotePanel 没传 accent 时的兜底
export const moduleAccents = {
  goals: "#e11d48",
  tasks: "#3b82f6",
  notes: "#8b5cf6",
  journal: "#f59e0b",
  reminders: "#0d9488",
  hotTopics: "#f97316",
  library: "#0ea5e9",
}

// 图标栏两种主题下都是深色，未激活图标用这个带一点绿的灰
export const railIconColor = "#93a39c"

// 条件不满足（比如必填项没填）时按钮的样式：置灰、鼠标显示禁止，配合 disabled 属性用，
// 让人一眼看出"现在点不了"，而不是点了没反应以为按钮坏了
export const disabledStyle = { opacity: 0.45, cursor: "not-allowed" }

export const radiusSm = 6
export const radiusMd = 12

// 字体搭配：衬线表达"知"（知行说话的语气、大标题），无衬线表达"行"（卡片、数据、控件），
// 两种字体明确分开，不是整页一种字体
export const fontSerif = "'Noto Serif SC', serif"
export const fontSans = "'Noto Sans SC', system-ui, sans-serif"

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
