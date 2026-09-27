import { useState, useEffect, useLayoutEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"
import { remarkPlugins } from "../markdown"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { moduleAccents, radiusSm, disabledStyle } from "../theme"
import { isSubmitEnter } from "../keyboard"
import { useConfirm } from "../confirm"
import { formatShort } from "../datetime"
import LoadError from "./LoadError"

// 渲染前把单个换行变成 Markdown 的硬换行（行尾两个空格）：手写笔记和 Notion 导入的内容里有很多
// "一行一句"的单换行，不处理的话 Markdown 会把它们合并成一段。代码块里的内容原样保留。
function preserveLineBreaks(text) {
  return (text || "")
    .split(/(```[\s\S]*?```)/g)
    .map(part => part.startsWith("```") ? part : part.replace(/([^\n])\n(?!\n)/g, "$1  \n"))
    .join("")
}

// 笔记正文按 Markdown 渲染（周复盘、Notion 笔记里都有标题、加粗、列表），
// 默认只显示前几行的高度，超出才出现"展开"，底部加一层渐隐，避免一条长笔记占满整个列表。
// 是否溢出靠实际测量（scrollHeight 大于 clientHeight），窗口变宽变窄时会重新测。
function NoteContent({ text, lines, fontSize }) {
  const { colors } = useTheme()
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const lineHeight = 1.6
  const collapsedHeight = `${lines * lineHeight}em`

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

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ position: "relative" }}>
        <div
          ref={ref}
          className="md"
          style={{ fontSize, lineHeight, color: colors.textSecondary, maxHeight: open ? undefined : collapsedHeight, overflow: "hidden" }}
        >
          <ReactMarkdown remarkPlugins={remarkPlugins}>{preserveLineBreaks(text)}</ReactMarkdown>
        </div>
        {!open && overflows && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "1.8em", background: `linear-gradient(to bottom, transparent, ${colors.cardBg})`, pointerEvents: "none" }} />
        )}
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

const SEARCH_TOP_K = 5

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
// 搜索框走语义检索（只取最相关的几条，清空搜索框自动回到完整列表），journal 分类下额外提供"生成本周复盘"入口，
// note 分类下提供"同步 Notion"（只读导入）；Notion 来源的笔记标出来源，不能在这里编辑或删除。
// 本地笔记可以编辑，日记不行（正文是结构化复盘渲染出来的，直接改正文会跟评分数据对不上）。
// 只用在单模块全页视图里：每条笔记一张白卡片，主要按钮用近黑实心（参考图风格）。
function NotePanel({ refreshKey, category, onRequestWeeklyReview, accent }) {
  const { colors, inputStyle, buttonStyle, iconButtonStyle, darkButtonStyle } = useTheme()
  const confirm = useConfirm()
  const resolvedAccent = accent ?? (category === "journal" ? moduleAccents.journal : moduleAccents.notes)
  const primaryBtn = darkButtonStyle
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeQuery, setActiveQuery] = useState("")  // 当前列表是哪个搜索词的结果，空串表示完整列表
  const [editingId, setEditingId] = useState(null)
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
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

  const fetchNotes = () => {
    setActiveQuery("")
    return load(() => apiFetch("/notes", { params: { category } }))
  }

  const runSearch = (query) => {
    setActiveQuery(query)
    return load(() => apiFetch("/notes/search", { params: { query, category, top_k: SEARCH_TOP_K } }))
  }

  // 新建/编辑/删除：失败时在列表上方提示，成功后重新拉列表（在搜索结果里操作的话，重新搜一次）
  const mutate = async (request) => {
    try {
      await request()
      setActionError(null)
      return true
    } catch (e) {
      setActionError(e.message)
      return false
    } finally {
      if (activeQuery) runSearch(activeQuery)
      else fetchNotes()
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
    setEditingId(null)
    setShowForm(false)
    setSyncStatus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, category])

  // 能不能保存：日记任意填一项就行（三道问题、四项评分、自由记录），笔记标题和正文都要有
  const journalFilled = review.done.trim() || review.blocker.trim() || review.tomorrow.trim()
    || Object.values(review.ratings).some(v => v != null) || newContent.trim()
  const noteFilled = newTitle.trim() && newContent.trim()
  const canSave = Boolean(category === "journal" ? journalFilled : noteFilled) && !saving
  const saveHint = category === "journal" ? "至少填一项再保存" : "标题和正文都要填"

  const addNote = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await submitNote()
    } finally {
      setSaving(false)
    }
  }

  const submitNote = async () => {
    if (category === "journal") {
      const { done, blocker, tomorrow, ratings } = review
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

  const deleteNote = async (n) => {
    const what = category === "journal" ? "日记" : "笔记"
    if (!(await confirm({ title: `删除${what}`, message: `「${n.title}」删除后无法恢复。` }))) return
    await mutate(() => apiFetch(`/notes/${n.id}`, { method: "DELETE" }))
  }

  const saveNote = async (id, changes) => {
    if (await mutate(() => apiFetch(`/notes/${id}`, { method: "PATCH", body: changes }))) setEditingId(null)
  }

  // 清空搜索框就自动回到完整列表，不用再按一次"搜"
  const onSearchChange = (value) => {
    setSearchQuery(value)
    if (!value.trim() && activeQuery) fetchNotes()
  }

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
      <div>
      {/* 搜索和操作按钮排成一行，按钮按内容宽度，主按钮近黑 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={e => isSubmitEnter(e) && refresh()}
          placeholder={category === "journal" ? "语义搜索日记..." : "语义搜索笔记..."}
          aria-label="语义搜索"
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        />
        <button onClick={refresh} style={buttonStyle}>搜</button>
        {category === "journal" && (
          <button onClick={onRequestWeeklyReview} style={buttonStyle}>生成本周复盘</button>
        )}
        {category === "note" && (
          <button onClick={syncNotion} disabled={syncing} style={{ ...buttonStyle, cursor: syncing ? "wait" : "pointer", opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "同步中..." : "同步 Notion"}
          </button>
        )}
        {!showForm && (
          <button onClick={() => setShowForm(true)} style={darkButtonStyle}>
            + {category === "journal" ? "写今天的日记" : "新建笔记"}
          </button>
        )}
      </div>
      {syncStatus && (
        <div style={{ fontSize: 12, margin: "-8px 0 12px", color: syncStatus.isError ? colors.danger : colors.textMuted }}>
          {syncStatus.text}
        </div>
      )}

      {!showForm ? null : category === "journal" ? (
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
            <button onClick={addNote} disabled={!canSave} title={!journalFilled ? saveHint : undefined} style={{ ...primaryBtn, flex: 1, ...(!canSave ? disabledStyle : {}) }}>
              {saving ? "保存中..." : "保存"}
            </button>
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
            <button onClick={addNote} disabled={!canSave} title={!noteFilled ? saveHint : undefined} style={{ ...primaryBtn, flex: 1, ...(!canSave ? disabledStyle : {}) }}>
              {saving ? "保存中..." : "保存"}
            </button>
            <button onClick={() => setShowForm(false)} style={buttonStyle}>取消</button>
          </div>
        </div>
      )}
      </div>

      {actionError && <div style={{ marginBottom: 8 }}><LoadError message={actionError} /></div>}
      {loading && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && error && <LoadError message={error} onRetry={refresh} />}
      {activeQuery && !loading && !error && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, display: "flex", gap: 8 }}>
          <span>与「{activeQuery}」最相关的 {notes.length} 条</span>
          <button onClick={() => { setSearchQuery(""); fetchNotes() }} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12, color: colors.primary }}>
            清除搜索
          </button>
        </div>
      )}
      {!loading && !error && notes.length === 0 && <div style={{ color: colors.textMuted }}>{activeQuery ? "没有搜到相关内容" : "暂无内容"}</div>}

      {notes.map(n => (
        <div
          key={n.id}
          style={{
            padding: "16px 20px",
            background: colors.cardBg,
            marginBottom: 10,
            borderRadius: 10,
            border: `1px solid ${colors.cardBorder}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <strong style={{ fontSize: 15.5, color: colors.text }}>{n.title}</strong>
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
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 11.5, color: colors.textMuted }}>{noteDateText(n)}</span>
              {n.source !== "notion" && n.category === "note" && editingId !== n.id && (
                <button onClick={() => setEditingId(n.id)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12, color: colors.textSecondary }} aria-label={`编辑：${n.title}`}>
                  编辑
                </button>
              )}
              {n.source !== "notion" && (
                <button onClick={() => deleteNote(n)} style={iconButtonStyle} title="删除" aria-label={`删除：${n.title}`}>×</button>
              )}
            </div>
          </div>
          {editingId === n.id ? (
            <NoteEditor note={n} onSave={changes => saveNote(n.id, changes)} onCancel={() => setEditingId(null)} />
          ) : (
            <NoteContent text={n.content} lines={4} fontSize={13} />
          )}
        </div>
      ))}
    </div>
  )
}

// 列表里的日期：显示创建日期，编辑过的再补一个"编辑于"（同一天编辑的显示时刻，不重复写日期）
function noteDateText(n) {
  const created = formatShort(n.created_at, { withTime: false })
  if (n.updated_at && n.created_at && new Date(n.updated_at) - new Date(n.created_at) > 60000) {
    const editedDay = formatShort(n.updated_at, { withTime: false })
    const edited = editedDay === created ? formatShort(n.updated_at).split(" ")[1] : editedDay
    return `${created} · 编辑于 ${edited}`
  }
  return created
}

function NoteEditor({ note, onSave, onCancel }) {
  const { inputStyle, buttonStyle, darkButtonStyle } = useTheme()
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    await onSave({ title: title.trim(), content })
    setSaving(false)
  }

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <input value={title} onChange={e => setTitle(e.target.value)} aria-label="标题" style={inputStyle} autoFocus />
      <textarea value={content} onChange={e => setContent(e.target.value)} aria-label="正文" rows={8} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button onClick={onCancel} style={buttonStyle}>取消</button>
        {/* 保存要重新算向量，会慢一点，给个状态 */}
        <button
          onClick={save}
          disabled={saving || !title.trim() || !content.trim()}
          title={!title.trim() || !content.trim() ? "标题和正文都不能为空" : undefined}
          style={{ ...darkButtonStyle, ...(saving || !title.trim() || !content.trim() ? disabledStyle : {}) }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  )
}

export default NotePanel
