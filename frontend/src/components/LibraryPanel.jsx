import { useEffect, useRef, useState } from "react"
import { API, authFetch, apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { useConfirm } from "../confirm"
import { disabledStyle } from "../theme"
import { isSubmitEnter } from "../keyboard"
import { formatShort } from "../datetime"
import LoadError from "./LoadError"
import NoteViewerModal from "./NoteViewerModal"
import { PageHeader, Badge, Modal, Field } from "./ui"

const SOURCE_LABEL = { hot_topic: "热点收藏", web: "网页", github: "GitHub", pdf: "PDF" }
const FILTERS = [["all", "全部"], ["hot_topic", "热点收藏"], ["web", "网页"], ["github", "GitHub"], ["pdf", "PDF"]]
const MAX_PDF_MB = 4

// 资料库预览只是正文前几百字，Markdown 符号直接露出来不好看，粗略去掉
const plainPreview = (text) => (text || "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`|]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()

// 资料库：收藏的热点、导入的网页和 GitHub 仓库、上传的 PDF。跟笔记共用一套向量检索，
// 知行回答问题时会一起搜到。导入要抓取正文、分块算向量，通常 5–15 秒，期间显示进度提示
function LibraryPanel({ refreshKey }) {
  const { colors, inputStyle, buttonStyle, darkButtonStyle, panelCardStyle, iconButtonStyle } = useTheme()
  const confirm = useConfirm()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState(null)   // null 表示没在搜；数组是语义搜索结果
  const [searching, setSearching] = useState(false)
  const [importing, setImporting] = useState(null) // null | 正在做什么的一句话
  const [notice, setNotice] = useState(null)       // { text, isError }
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [viewing, setViewing] = useState(null)     // 正在看全文的 note id
  const fileRef = useRef(null)

  const fetchItems = async () => {
    try {
      setItems(await apiFetch("/library"))
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [refreshKey])

  const search = async () => {
    const q = query.trim()
    if (!q) { setResults(null); return }
    setSearching(true)
    try {
      const hits = await apiFetch("/notes/search", { params: { query: q, category: "library", top_k: 8 } })
      setResults(hits)
    } catch (e) {
      setNotice({ text: `搜索失败：${e.message}`, isError: true })
    } finally {
      setSearching(false)
    }
  }

  const addLink = async (url, title) => {
    setImporting("正在抓取网页正文并建立索引，通常要 5–15 秒…")
    setNotice(null)
    try {
      const item = await apiFetch("/library/url", { method: "POST", body: { url, title: title || null } })
      setNotice({ text: item.existed ? `已经收藏过了：${item.title}` : `已收藏：${item.title}`, isError: false })
      setShowLinkModal(false)
      fetchItems()
      return true
    } catch (e) {
      setNotice({ text: e.message, isError: true })
      return false
    } finally {
      setImporting(null)
    }
  }

  // PDF 直接把文件字节作为请求体发给后端（不走表单），文件名放查询参数
  const uploadPdf = async (file) => {
    if (!file) return
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setNotice({ text: `PDF 超过 ${MAX_PDF_MB}MB，线上环境传不上去，可以先压缩或拆开`, isError: true })
      return
    }
    setImporting(`正在解析「${file.name}」并建立索引…`)
    setNotice(null)
    try {
      const url = new URL(`${API}/library/pdf`, window.location.origin)
      url.searchParams.set("filename", file.name)
      const res = await authFetch(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail || `上传失败（${res.status}）`)
      setNotice({ text: `已导入：${data.title}（${data.pages} 页）`, isError: false })
      fetchItems()
    } catch (e) {
      setNotice({ text: e.message, isError: true })
    } finally {
      setImporting(null)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const remove = async (item) => {
    if (!(await confirm({ title: "删除资料", message: `「${item.title}」删除后，知行就检索不到它了。` }))) return
    try {
      await apiFetch(`/notes/${item.id}`, { method: "DELETE" })
      setResults(r => r && r.filter(x => x.id !== item.id))
      fetchItems()
    } catch (e) {
      setNotice({ text: `删除失败：${e.message}`, isError: true })
    }
  }

  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === "all" ? items.length : items.filter(i => i.source === k).length]))
  // 搜索结果（笔记接口返回的格式）转成跟列表一样的形状，预览换成命中的那一段
  const shown = results
    ? results.map(r => ({ ...r, preview: r.snippet, domain: r.url ? new URL(r.url).hostname.replace(/^www\./, "") : null }))
    : items.filter(i => filter === "all" || i.source === filter)

  return (
    <div>
      <PageHeader
        eyebrow="收藏的文章、仓库、网页和 PDF，知行回答问题时会一起检索"
        title="资料库"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => fileRef.current?.click()} disabled={!!importing} style={{ ...buttonStyle, ...(importing ? disabledStyle : {}) }}>上传 PDF</button>
            <button onClick={() => setShowLinkModal(true)} disabled={!!importing} style={{ ...darkButtonStyle, ...(importing ? disabledStyle : {}) }}>+ 导入链接</button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={e => uploadPdf(e.target.files?.[0])} style={{ display: "none" }} />
          </div>
        }
      />

      {importing && <div style={{ fontSize: 13, color: colors.ink, marginBottom: 12 }}>{importing}</div>}
      {notice && <div style={{ fontSize: 13, color: notice.isError ? colors.danger : colors.textMuted, marginBottom: 12 }}>{notice.text}</div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); if (!e.target.value.trim()) setResults(null) }}
          onKeyDown={e => isSubmitEnter(e) && search()}
          placeholder="语义搜索资料库…"
          aria-label="语义搜索资料库"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={search} style={buttonStyle}>{searching ? "搜索中…" : "搜"}</button>
      </div>

      {results ? (
        <div style={{ fontSize: 12.5, color: colors.textMuted, marginBottom: 12, display: "flex", gap: 10 }}>
          <span>与「{query.trim()}」最相关的 {results.length} 条</span>
          <button onClick={() => { setQuery(""); setResults(null) }} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: colors.ink }}>清除搜索</button>
        </div>
      ) : (
        <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              style={{
                padding: "4px 12px", borderRadius: 999, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${filter === key ? colors.btnDark : colors.cardBorder}`,
                background: filter === key ? colors.btnDark : colors.cardBg,
                color: filter === key ? colors.btnDarkText : colors.textSecondary,
              }}
            >
              {label} {counts[key]}
            </button>
          ))}
        </div>
      )}

      {error && <LoadError message={error} onRetry={fetchItems} />}
      {loading && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && !error && shown.length === 0 && (
        <div style={{ ...panelCardStyle, padding: "28px 24px", color: colors.textSecondary, fontSize: 14, lineHeight: 1.7 }}>
          {results ? "没有搜到相关资料。" : (
            <>
              资料库还是空的。可以这样往里放东西：
              <div style={{ marginTop: 6, color: colors.textMuted, fontSize: 13.5 }}>
                · 在「热点」里点条目右边的「收藏」<br />
                · 右上角「导入链接」贴一个网页或 GitHub 仓库地址<br />
                · 「上传 PDF」导入论文、文档（{MAX_PDF_MB}MB 以内，扫描版提取不出文字）<br />
                · 跟知行说「把这个链接存下来」
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map(item => (
          <div key={item.id} style={{ ...panelCardStyle, padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <button onClick={() => setViewing(item.id)} title="查看全文" style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: colors.text, lineHeight: 1.4 }}>{item.title}</div>
              </button>
              <Badge tone="ink">{SOURCE_LABEL[item.source] ?? item.source}</Badge>
              <button onClick={() => remove(item)} style={iconButtonStyle} title="删除" aria-label={`删除：${item.title}`}>×</button>
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {item.domain && <span>{item.domain}</span>}
              <span>{formatShort(item.created_at, { withTime: false })}</span>
              {item.length != null && <span>{item.length.toLocaleString()} 字</span>}
              {item.url && <a href={item.url} target="_blank" rel="noreferrer" style={{ color: colors.ink }}>打开原文 ↗</a>}
            </div>
            <div style={{ fontSize: 13.5, color: colors.textSecondary, marginTop: 8, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {plainPreview(item.preview)}
            </div>
          </div>
        ))}
      </div>

      {showLinkModal && <LinkModal busy={!!importing} onSubmit={addLink} onClose={() => setShowLinkModal(false)} />}
      {viewing && <NoteViewerModal noteId={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function LinkModal({ busy, onSubmit, onClose }) {
  const { inputStyle, buttonStyle, darkButtonStyle } = useTheme()
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const valid = /^https?:\/\/\S+$/.test(url.trim())
  const submit = () => { if (valid && !busy) onSubmit(url.trim(), title.trim()) }
  return (
    <Modal
      title="导入链接"
      onClose={onClose}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={buttonStyle}>取消</button>
          <button onClick={submit} disabled={!valid || busy} style={{ ...darkButtonStyle, ...(!valid || busy ? disabledStyle : {}) }}>{busy ? "导入中…" : "导入"}</button>
        </>
      }
    >
      <Field label="网址" hint="网页会抓取正文；GitHub 仓库地址会导入它的 README">
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => isSubmitEnter(e) && submit()} placeholder="https://..." style={inputStyle} />
      </Field>
      <Field label="标题" hint="可选，不填就从网页里取">
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => isSubmitEnter(e) && submit()} style={inputStyle} />
      </Field>
    </Modal>
  )
}

export default LibraryPanel
