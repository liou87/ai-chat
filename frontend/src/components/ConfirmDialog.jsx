import { useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "../ThemeContext"
import { ConfirmContext } from "../confirm"
import { radiusMd } from "../theme"

// 统一样式的确认弹窗，替代浏览器原生 confirm()：删除类操作都走这里。
// Esc / 点遮罩 = 取消，打开时焦点落在确认按钮上，直接回车就是确认。
export function ConfirmProvider({ children }) {
  const { colors, buttonStyle } = useTheme()
  const [dialog, setDialog] = useState(null)  // { title, message, confirmText, resolve }
  const confirmBtnRef = useRef(null)

  const confirm = useCallback(({ title, message, confirmText = "删除" }) => (
    new Promise(resolve => setDialog({ title, message, confirmText, resolve }))
  ), [])

  const close = (result) => {
    dialog?.resolve(result)
    setDialog(null)
  }

  useEffect(() => {
    if (!dialog) return
    confirmBtnRef.current?.focus()
    const onKey = (e) => { if (e.key === "Escape") close(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div
          onClick={() => close(false)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={e => e.stopPropagation()}
            style={{ width: 360, maxWidth: "100%", background: colors.surface, borderRadius: radiusMd, padding: "20px 20px 16px", boxShadow: "0 12px 40px rgba(0,0,0,0.24)" }}
          >
            <div id="confirm-title" style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>{dialog.title}</div>
            {dialog.message && <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 8, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{dialog.message}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => close(false)} style={buttonStyle}>取消</button>
              <button
                ref={confirmBtnRef}
                onClick={() => close(true)}
                style={{ ...buttonStyle, background: colors.danger, border: `1px solid ${colors.danger}`, color: "#fff" }}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
