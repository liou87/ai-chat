import { useState, useEffect, useLayoutEffect, useRef } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents, radiusSm, formMaxWidth } from "../theme"
import { isSubmitEnter } from "../keyboard"
import LoadError from "./LoadError"

// 笔记正文默认只显示前几行，超出才出现"展开"，避免一条长笔记（比如 Notion 长页面）占满整个列表。
// 是否溢出靠实际测量（scrollHeight 大于 clientHeight），不靠字数估算，聊天面板收起、窗口变宽时会重新测。
function NoteContent({ text, lines, fontSize }) {
  const { colors } = useTheme()
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)

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

  const clamp = open ? {} : {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div ref={ref} style={{ fontSize, color: colors.textSecondary, whiteSpace: "pre-wrap", ...clamp }}>
        {text}
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

const RATING_ITEMS = [
  { key: "energy", label: "精力" },
  { key: "stress", label: "压力" },
  { key: "satisfaction", label: "满意度" },
  { key: "focus", label: "专注度" },
]

// 1-5 分的评分选择器，5 个小圆点按钮，选中的用强调色填充
function RatingPicker({ label, value, onChange, accent, colors }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12.5, color: colors.textSecondary, width: 46, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", gap: 5 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            style={{
              width: 22, height: 22, borderRadius: "50%", fontSize: 11, cursor: "pointer",
              border: `1px solid ${value === n ? accent : colors.border}`,
              background: value === n ? accent : "none",
              color: value === n ? "#fff" : colors.textMuted,
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

// 笔记 / 日记复盘共用的内容面板，category 由外层容器决定，accent 决定这张卡片的强调色。
// 搜索框走语义检索并展示相似度分数，journal 分类下额外提供"生成本周复盘"入口，
// note 分类下提供"同步 Notion"（只读导入）；Notion 来源的笔记标出来源，且不能在这里删除。
// mode="expanded" 用于图标栏点开的单模块全页视图：每条笔记独立卡片、字号更大。
function NotePanel({ refreshKey, category, onRequestWeeklyReview, accent, mode = "compact" }) {
  const { colors, inputStyle, buttonStyle, accentButtonStyle, iconButtonStyle } = useTheme()
  const expanded = mode === "expanded"
  const resolvedAccent = accent ?? (category === "journal" ? moduleAccents.journal : moduleAccents.notes)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)   // { text, isError }

  // 日记复盘的引导表单状态：三道固定问题 + 四项 1-5 评分，都是可选的，跟自由记录二选一或者都填
  const emptyReview = { done: "", blocker: "", tomorrow: "", ratings: { energy: null, stress: null, satisfaction: null, focus: null } }
  const [review, setReview] = useState(emptyReview)

  const load = async (request) => {
    setLoading(true)
    try {
      setNotes(await request())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchNotes = () => load(() => apiFetch("/notes", { params: { category } }))

  const runSearch = (query) => load(() => apiFetch("/notes/search", { params: { query, category } }))

  // 新建/删除：失败时在列表上方提示，成功后重新拉列表
  const mutate = async (request) => {
    try {
      await request()
      setActionError(null)
      return true
    } catch (e) {
      setActionError(e.message)
      return false
    } finally {
      fetchNotes()
    }
  }

  const refresh = () => {
    if (searchQuery.trim()) {
      runSearch(searchQuery.trim())
    } else {
      fetchNotes()
    }
  }

  useEffect(() => {
    setSearchQuery("")
    setShowForm(false)
    setSyncStatus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, category])

  const addNote = async () => {
    if (category === "journal") {
      const { done, blocker, tomorrow, ratings } = review
      const hasRating = Object.values(ratings).some(v => v != null)
      if (!done.trim() && !blocker.trim() && !tomorrow.trim() && !hasRating && !newContent.trim()) return
      const ok = await mutate(() => apiFetch("/notes", {
        method: "POST",
        body: {
          category,
          structured_data: {
            answers: { done: done.trim(), blocker: blocker.trim(), tomorrow: tomorrow.trim() },
            ratings,
            notes: newContent.trim(),
          },
        },
      }))
      // 保存失败时保留表单内容，免得辛苦写的日记白写
      if (ok) {
        setReview(emptyReview)
        setNewContent("")
        setShowForm(false)
      }
      return
    }

    if (!newContent.trim() || !newTitle.trim()) return
    const ok = await mutate(() => apiFetch("/notes", {
      method: "POST",
      body: { title: newTitle, content: newContent, category },
    }))
    if (ok) {
      setNewTitle("")
      setNewContent("")
      setShowForm(false)
    }
  }

  const deleteNote = (id) => mutate(() => apiFetch(`/notes/${id}`, { method: "DELETE" }))

  const syncNotion = async () => {
    setSyncing(true)
    setSyncStatus(null)
    try {
      const data = await apiFetch("/notes/sync-notion", { method: "POST" })
      const parts = [`新增 ${data.imported}`, `更新 ${data.updated}`, `跳过 ${data.skipped}`]
      if (data.deleted > 0) parts.push(`删除 ${data.deleted}`)
      if (data.failed > 0) parts.push(`失败 ${data.failed}`)
      setSyncStatus({ text: parts.join(" · "), isError: data.failed > 0 })
      refresh()
    } catch (e) {
      setSyncStatus({ text: `同步失败：${e.message}`, isError: true })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <div style={{ maxWidth: formMaxWidth }}>
      {category === "journal" && (
        <button onClick={onRequestWeeklyReview} style={{ ...accentButtonStyle(resolvedAccent), width: "100%", marginBottom: 12 }}>
          生成本周复盘
        </button>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => isSubmitEnter(e) && refresh()}
          placeholder={category === "journal" ? "语义搜索日记..." : "语义搜索笔记..."}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={refresh} style={buttonStyle}>搜</button>
      </div>

      {!showForm ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowForm(true)} style={{ ...accentButtonStyle(resolvedAccent), flex: 1 }}>
              + {category === "journal" ? "写今天的日记" : "新建笔记"}
            </button>
            {category === "note" && (
              <button
                onClick={syncNotion}
                disabled={syncing}
                style={{ ...buttonStyle, cursor: syncing ? "wait" : "pointer", opacity: syncing ? 0.6 : 1 }}
              >
                {syncing ? "同步中..." : "同步 Notion"}
              </button>
            )}
          </div>
          {syncStatus && (
            <div style={{ fontSize: 12, marginTop: 6, color: syncStatus.isError ? colors.danger : colors.textMuted }}>
              {syncStatus.text}
            </div>
          )}
        </div>
      ) : category === "journal" ? (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={review.done}
            onChange={e => setReview({ ...review, done: e.target.value })}
            placeholder="今天完成了什么？"
            style={inputStyle}
          />
          <input
            value={review.blocker}
            onChange={e => setReview({ ...review, blocker: e.target.value })}
            placeholder="今天最大的阻碍是什么？"
            style={inputStyle}
          />
          <input
            value={review.tomorrow}
            onChange={e => setReview({ ...review, tomorrow: e.target.value })}
            placeholder="明天最重要的一件事？"
            style={inputStyle}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" }}>
            {RATING_ITEMS.map(({ key, label }) => (
              <RatingPicker
                key={key}
                label={label}
                value={review.ratings[key]}
                onChange={v => setReview({ ...review, ratings: { ...review.ratings, [key]: v } })}
                accent={resolvedAccent}
                colors={colors}
              />
            ))}
          </div>
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="自由记录（可选）"
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={addNote} style={{ ...accentButtonStyle(resolvedAccent), flex: 1 }}>保存</button>
            <button onClick={() => { setShowForm(false); setReview(emptyReview); setNewContent("") }} style={buttonStyle}>取消</button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="标题"
            style={inputStyle}
          />
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="正文"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={addNote} style={{ ...accentButtonStyle(resolvedAccent), flex: 1 }}>保存</button>
            <button onClick={() => setShowForm(false)} style={buttonStyle}>取消</button>
          </div>
        </div>
      )}
      </div>

      {actionError && <div style={{ marginBottom: 8 }}><LoadError message={actionError} /></div>}
      {loading && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && error && <LoadError message={error} onRetry={refresh} />}
      {!loading && !error && notes.length === 0 && <div style={{ color: colors.textMuted }}>暂无内容</div>}

      {notes.map(n => (
        <div
          key={n.id}
          style={{
            padding: expanded ? "14px 16px" : "8px 0",
            marginBottom: expanded ? 10 : 0,
            borderRadius: expanded ? 10 : 0,
            border: expanded ? `1px solid ${colors.borderLight}` : "none",
            borderBottom: `1px solid ${colors.borderLight}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <strong style={{ fontSize: expanded ? 15.5 : 14, color: colors.text }}>{n.title}</strong>
              {n.source === "notion" && (
                <span style={{
                  fontSize: 10.5,
                  padding: "1px 6px",
                  borderRadius: radiusSm,
                  border: `1px solid ${colors.border}`,
                  color: colors.textMuted,
                  flexShrink: 0,
                }}>
                  Notion
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {n.score !== undefined && (
                <span style={{ fontSize: 11, color: resolvedAccent }}>{n.score.toFixed(2)}</span>
              )}
              {n.source !== "notion" && (
                <button onClick={() => deleteNote(n.id)} style={iconButtonStyle} title="删除" aria-label={`删除：${n.title}`}>×</button>
              )}
            </div>
          </div>
          <NoteContent text={n.content} lines={expanded ? 4 : 3} fontSize={expanded ? 13 : 12} />
        </div>
      ))}
    </div>
  )
}

export default NotePanel
