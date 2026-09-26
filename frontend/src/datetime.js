// 后端返回的时间都是不带时区的 ISO 字符串（按后端 APP_TIMEZONE 配置的时区），浏览器按本地时间解析，
// 所以 APP_TIMEZONE 要跟使用者浏览器所在时区一致

const pad = (n) => String(n).padStart(2, "0")

// ISO 字符串 -> datetime-local 控件要的 "YYYY-MM-DDTHH:mm"
export function toInputValue(iso) {
  if (!iso) return ""
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 列表里显示用的简短时间：今年的省略年份，比如"9月27日 18:00"；withTime=false 只显示日期
export function formatShort(iso, { withTime = true } = {}) {
  if (!iso) return ""
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const date = `${sameYear ? "" : d.getFullYear() + "年"}${d.getMonth() + 1}月${d.getDate()}日`
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

// 会话列表分组用：今天 / 昨天 / 最近 7 天 / 更早
export function dayBucket(iso) {
  if (!iso) return "更早"
  const d = new Date(iso)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
  if (diffDays <= 0) return "今天"
  if (diffDays === 1) return "昨天"
  if (diffDays < 7) return "最近 7 天"
  return "更早"
}
