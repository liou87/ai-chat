// 任务的优先级、排序、时长格式这些共用的定义：任务页和总览都用得到，单独放一个文件
// （组件文件里只导出组件，Vite 的热更新才能正常工作）

export const PRIORITY_OPTIONS = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
]
export const PRIORITY_LABEL = { high: "高", medium: "中", low: "低" }
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }
export const PRIORITY_TONE = { high: "danger", medium: "neutral", low: "neutral" }

// 未完成的排序：先按优先级（高→低），同优先级按截止时间，没截止时间的排后面
export const byPriorityThenDue = (a, b) => {
  const p = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1)
  if (p !== 0) return p
  if (!a.due_at) return 1
  if (!b.due_at) return -1
  return new Date(a.due_at) - new Date(b.due_at)
}

// 分钟数 -> "5h 20m" / "45m"
export function formatMinutes(total) {
  if (!total) return "—"
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

export const isOverdue = (t) => !t.done && t.due_at && new Date(t.due_at) < new Date()

