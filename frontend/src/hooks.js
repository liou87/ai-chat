import { useEffect, useState } from "react"

// 窗口宽度，用来决定侧栏要不要收成只有图标
export function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return width
}

// 某个元素的实际宽度：总览要按主区域自己的宽度切单列/双列，
// 不能只看窗口宽度——聊天面板展开、收起、拖宽都会改变主区域能用的宽度
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
