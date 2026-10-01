import { useEffect, useState } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { disabledStyle } from "../theme"
import { isSubmitEnter } from "../keyboard"
import { formatShort } from "../datetime"
import LoadError from "./LoadError"
import { PageHeader, Badge } from "./ui"
import DevicesCard from "./DevicesCard"

const CATEGORIES = [
  ["identity", "身份", "学校、专业、工作"],
  ["goal", "目标", "在准备什么、想达成什么"],
  ["preference", "偏好", "喜欢怎样的回答、作息、习惯"],
  ["status", "近况", "这段时间在忙的事"],
]

// "关于我"：核心记忆。知行每次对话都会带上这些信息；它在对话里发现新信息时会自动增改，
// 你在这里也可以直接改、删、补充。按类别分四块，每条标明是知行记的还是你自己写的
function ProfilePanel({ refreshKey }) {
  const { colors, panelCardStyle } = useTheme()
  const confirm = useConfirm()
  const [facts, setFacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)

  const fetchFacts = async () => {
    try {
      setFacts(await apiFetch("/profile"))
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFacts()
  }, [refreshKey])

  const mutate = async (request) => {
    try {
      await request()
      setActionError(null)
      return true
    } catch (e) {
      setActionError(e.message)
      return false
    } finally {
      fetchFacts()
    }
  }

  const add = (category, content) => mutate(() => apiFetch("/profile", { method: "POST", body: { category, content } }))
  const update = (id, content) => mutate(() => apiFetch(`/profile/${id}`, { method: "PATCH", body: { content } }))
  const remove = async (f) => {
    if (!(await confirm({ title: "删除这条记忆", message: `「${f.content}」\n删掉后知行就不知道这件事了。` }))) return
    await mutate(() => apiFetch(`/profile/${f.id}`, { method: "DELETE" }))
  }

  return (
    <div>
      <PageHeader eyebrow="核心记忆 · 知行每次对话都会带上这些信息" title="关于我" />
      <div style={{ fontSize: 13.5, color: colors.textSecondary, lineHeight: 1.7, marginBottom: 18 }}>
        跟知行聊天时提到自己的情况，它会自动记下来，并在聊天里提示「已记住」，可以随时撤销。你也可以在这里直接补充或修改。
      </div>
      {actionError && <div style={{ marginBottom: 12 }}><LoadError message={actionError} /></div>}
      {error && <LoadError message={error} onRetry={fetchFacts} />}
      {loading && <div style={{ color: colors.textMuted }}>加载中...</div>}

      {!loading && !error && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16, alignItems: "start" }}>
          {CATEGORIES.map(([key, label, hint]) => (
            <div key={key} style={{ ...panelCardStyle, padding: "16px 20px 12px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{label}</span>
                <span style={{ fontSize: 12, color: colors.textMuted }}>{hint}</span>
              </div>
              {facts.filter(f => f.category === key).map(f => (
                <FactRow key={f.id} fact={f} onSave={content => update(f.id, content)} onDelete={() => remove(f)} />
              ))}
              {facts.every(f => f.category !== key) && (
                <div style={{ fontSize: 13, color: colors.textMuted, padding: "6px 0" }}>还没有</div>
              )}
              <AddRow placeholder={`补充一条${label}…`} onAdd={content => add(key, content)} />
            </div>
          ))}
        </div>
      )}

      <DevicesCard />
    </div>
  )
}

function FactRow({ fact, onSave, onDelete }) {
  const { colors, inputStyle, iconButtonStyle } = useTheme()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.content)

  const save = async () => {
    if (!draft.trim() || draft.trim() === fact.content) { setEditing(false); return }
    if (await onSave(draft.trim())) setEditing(false)
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${colors.borderLight}` }}>
      {editing ? (
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (isSubmitEnter(e)) save(); if (e.key === "Escape") { setDraft(fact.content); setEditing(false) } }}
          onBlur={save}
          maxLength={300}
          aria-label="修改记忆"
          style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "4px 8px" }}
          autoFocus
        />
      ) : (
        <button
          onClick={() => { setDraft(fact.content); setEditing(true) }}
          title={`点击修改 · ${formatShort(fact.updated_at)} 更新`}
          style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: colors.text, lineHeight: 1.5 }}
        >
          {fact.content}
        </button>
      )}
      <Badge tone={fact.source === "agent" ? "ink" : "neutral"}>{fact.source === "agent" ? "知行记的" : "你写的"}</Badge>
      <button onClick={onDelete} style={iconButtonStyle} title="删除" aria-label={`删除：${fact.content}`}>×</button>
    </div>
  )
}

function AddRow({ placeholder, onAdd }) {
  const { inputStyle, buttonStyle } = useTheme()
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const can = value.trim() !== "" && !saving
  const submit = async () => {
    if (!can) return
    setSaving(true)
    if (await onAdd(value.trim())) setValue("")
    setSaving(false)
  }
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
      <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => isSubmitEnter(e) && submit()} placeholder={placeholder} maxLength={300} style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: 13, padding: "5px 9px" }} />
      <button onClick={submit} disabled={!can} style={{ ...buttonStyle, fontSize: 13, padding: "5px 10px", ...(!can ? disabledStyle : {}) }}>添加</button>
    </div>
  )
}

export default ProfilePanel
