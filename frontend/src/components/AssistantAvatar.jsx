import { useTheme } from "../ThemeContext"

// 知行的头像：圆形底色 + 两个眼睛，回复中时嘴部换成三个交替呼吸的点，暗示在思考/输出。
// 纯 SVG + index.css 里的一个 CSS 动画，不引入动画库，跟 icons.jsx 那套手绘线条图标的极简调子保持一致。
function AssistantAvatar({ active = false, size = 26 }) {
  const { colors } = useTheme()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill={colors.primary} />
      <circle cx="8.5" cy="10.5" r="1.5" fill="#fff" />
      <circle cx="15.5" cy="10.5" r="1.5" fill="#fff" />
      {active ? (
        <>
          <circle className="zx-avatar-dot" cx="8.5" cy="16" r="1.1" fill="#fff" style={{ animationDelay: "0s" }} />
          <circle className="zx-avatar-dot" cx="12" cy="16" r="1.1" fill="#fff" style={{ animationDelay: "0.2s" }} />
          <circle className="zx-avatar-dot" cx="15.5" cy="16" r="1.1" fill="#fff" style={{ animationDelay: "0.4s" }} />
        </>
      ) : (
        <path d="M8.5 15.5 Q12 18 15.5 15.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      )}
    </svg>
  )
}

export default AssistantAvatar
