import { createContext, useContext } from "react"

// 确认弹窗的 context：ConfirmProvider 挂在最外层，各组件用 useConfirm() 拿到一个返回 Promise<boolean> 的函数，
// 写法是 if (!(await confirm({ title, message }))) return，不用每个组件自己管弹窗状态
export const ConfirmContext = createContext(null)

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error("useConfirm 必须在 ConfirmProvider 内部使用")
  return confirm
}
