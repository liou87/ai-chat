import { useTheme } from "../ThemeContext"
import { PageHeader } from "./ui"

// 单模块页面的容器：内容放在一个居中、限宽的栏里，两侧留白对称，不会只有右边空一大块。
// 传了 title 就在顶部画标题区；任务、目标这类标题区右侧有"新增"按钮、按钮要打开组件内部弹窗的，
// 不传 title，由组件自己渲染 PageHeader。
// width 是内容栏的最大宽度：卡片网格/表格类给宽一点，笔记这种阅读类给窄一点
function ModulePage({ eyebrow, title, action, width = 1080, children }) {
  const { colors } = useTheme()
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", background: colors.pageBg }}>
      <div style={{ maxWidth: width, margin: "0 auto", padding: "32px 32px 48px", boxSizing: "border-box" }}>
        {title && <PageHeader eyebrow={eyebrow} title={title} action={action} />}
        {children}
      </div>
    </div>
  )
}

export default ModulePage
