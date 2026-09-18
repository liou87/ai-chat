import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { lightColors, darkColors, moduleAccents, buildStyles } from "./theme"

const ThemeContext = createContext(null)

const STORAGE_KEY = "ai-chat-theme"

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "light" || saved === "dark") return saved
  } catch {
    // localStorage 不可用（隐私模式等）就用默认值，不报错
  }
  return "light"
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // 存不进去就算了，不影响当次会话的主题
    }
    // 同步原生控件（checkbox、日期选择器等）的默认配色
    document.documentElement.style.colorScheme = theme
    // 给全局 CSS（比如 markdown 渲染出来的 <code>）一个可以选择器命中的挂钩
    document.documentElement.dataset.theme = theme
  }, [theme])

  const value = useMemo(() => {
    const colors = theme === "dark" ? darkColors : lightColors
    return {
      theme,
      isDark: theme === "dark",
      toggleTheme: () => setTheme(t => (t === "dark" ? "light" : "dark")),
      colors,
      moduleAccents,
      ...buildStyles(colors),
    }
  }, [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内部使用")
  return ctx
}
