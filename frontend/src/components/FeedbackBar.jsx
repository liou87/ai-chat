import { useState } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { ModuleIcon } from "../icons"

const FEEDBACK_REASONS = [
  ["wrong", "答错了"],
  ["fabricated", "编造了内容"],
  ["missed_tool", "该用工具没用"],
  ["verbose", "啰嗦"],
  ["other", "其它"],
]

// 每条回复下面的一行小操作：查看轨迹、点赞、点踩（第四层评测：线上反馈回流）。
// 点踩时展开一小块面板选原因、可以写一句，原因决定以后往评测里补哪类用例；再点一次同一个图标就撤销
function FeedbackBar({ trace, feedback, onChange, onOpenTrace }) {
  const { colors, inputStyle } = useTheme()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(feedback?.reason ?? null)
  const [comment, setComment] = useState(feedback?.comment ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const path = `/feedback/${trace.sessionId}/${trace.turnIndex}`
  const save = async (body) => {
    setSaving(true)
    setError(null)
    try {
      onChange(body ? await apiFetch(path, { method: "PUT", body }) : (await apiFetch(path, { method: "DELETE" }), null))
      setOpen(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const rating = feedback?.rating
  const iconBtn = (active, color) => ({
    border: "none", background: "none", padding: 2, cursor: saving ? "wait" : "pointer", display: "flex",
    opacity: active ? 1 : 0.7, color: active ? color : colors.textMuted,
  })

  return (
    <div style={{ alignSelf: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onOpenTrace} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 11, color: colors.textMuted }}>
          查看轨迹
        </button>
        <button
          onClick={() => save(rating === "up" ? null : { rating: "up" })}
          disabled={saving}
          title={rating === "up" ? "撤销点赞" : "回答得好"}
          aria-label="点赞" aria-pressed={rating === "up"}
          style={iconBtn(rating === "up", colors.ink)}
        >
          <ModuleIcon name="thumbUp" color="currentColor" size={12} strokeWidth={rating === "up" ? 2.4 : 2} />
        </button>
        <button
          onClick={() => rating === "down" ? save(null) : setOpen(o => !o)}
          disabled={saving}
          title={rating === "down" ? "撤销点踩" : "回答有问题"}
          aria-label="点踩" aria-pressed={rating === "down"} aria-expanded={open}
          style={iconBtn(rating === "down" || open, colors.danger)}
        >
          <ModuleIcon name="thumbDown" color="currentColor" size={12} strokeWidth={rating === "down" ? 2.4 : 2} />
        </button>
        {rating === "down" && feedback.reason_label && (
          <span style={{ fontSize: 11, color: colors.textMuted }}>已反馈：{feedback.reason_label}</span>
        )}
        {error && <span style={{ fontSize: 11, color: colors.danger }}>{error}</span>}
      </div>

      {open && (
        <div style={{ marginTop: 6, padding: "10px 12px", borderRadius: 8, border: `1px solid ${colors.borderLight}`, background: colors.surface, maxWidth: 420 }}>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 6 }}>哪里不好？</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {FEEDBACK_REASONS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setReason(key)}
                aria-pressed={reason === key}
                style={{
                  fontSize: 12, padding: "3px 9px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${reason === key ? colors.ink : colors.border}`,
                  background: reason === key ? colors.inkSoft : "transparent",
                  color: reason === key ? colors.ink : colors.textSecondary,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="补充一句（可选），比如应该怎么回答"
            maxLength={500}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginTop: 8, fontSize: 12.5 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button onClick={() => setOpen(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, color: colors.textMuted }}>取消</button>
            <button
              onClick={() => save({ rating: "down", reason: reason ?? "other", comment })}
              disabled={saving}
              style={{ border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12, background: colors.primary, color: colors.primaryText }}
            >
              {saving ? "提交中…" : "提交"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default FeedbackBar
