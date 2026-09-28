import { useLayoutEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { remarkPlugins } from "../markdown"
import { useTheme } from "../ThemeContext"

// 渲染前把单个换行变成 Markdown 的硬换行（行尾两个空格）：手写笔记和 Notion 导入的内容里有很多
// "一行一句"的单换行，不处理的话 Markdown 会把它们合并成一段。代码块里的内容原样保留。
function preserveLineBreaks(text) {
  return (text || "")
    .split(/(```[\s\S]*?```)/g)
    .map(part => part.startsWith("```") ? part : part.replace(/([^\n])\n(?!\n)/g, "$1  \n"))
    .join("")
}

// 笔记正文按 Markdown 渲染（周复盘、Notion 笔记里都有标题、加粗、列表），
// 默认只显示前几行的高度，超出才出现"展开"，底部加一层渐隐，避免一条长笔记占满整个列表。
// 是否溢出靠实际测量（scrollHeight 大于 clientHeight），窗口变宽变窄时会重新测。
function NoteContent({ text, lines, fontSize, defaultOpen = false }) {
  const { colors } = useTheme()
  const ref = useRef(null)
  const [open, setOpen] = useState(defaultOpen)
  const [overflows, setOverflows] = useState(false)
  const lineHeight = 1.6
  const collapsedHeight = `${lines * lineHeight}em`

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      if (!open) setOverflows(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, lines, open])

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ position: "relative" }}>
        <div
          ref={ref}
          className="md"
          style={{ fontSize, lineHeight, color: colors.textSecondary, maxHeight: open ? undefined : collapsedHeight, overflow: "hidden" }}
        >
          <ReactMarkdown remarkPlugins={remarkPlugins}>{preserveLineBreaks(text)}</ReactMarkdown>
        </div>
        {!open && overflows && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "1.8em", background: `linear-gradient(to bottom, transparent, ${colors.cardBg})`, pointerEvents: "none" }} />
        )}
      </div>
      {overflows && (
        <button
          onClick={() => setOpen(!open)}
          style={{ border: "none", background: "none", cursor: "pointer", padding: 0, marginTop: 4, fontSize: 12, color: colors.textSecondary }}
        >
          {open ? "收起" : "展开"}
        </button>
      )}
    </div>
  )
}

export default NoteContent
