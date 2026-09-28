import { useEffect, useState } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { formatShort } from "../datetime"
import LoadError from "./LoadError"
import NoteContent from "./NoteContent"
import { Modal, Badge } from "./ui"

const SOURCE_LABEL = { local: "笔记", notion: "Notion", hot_topic: "热点收藏", web: "网页", github: "GitHub", pdf: "PDF" }

// 查看一条笔记/资料的全文：资料库列表只有预览，聊天里的引用标签也只有标题，点开时按 id 取全文
function NoteViewerModal({ noteId, onClose }) {
  const { colors } = useTheme()
  const [note, setNote] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/notes/${noteId}`)
      .then(n => { if (!cancelled) setNote(n) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [noteId])

  const source = note ? (note.category === "journal" ? "日记" : SOURCE_LABEL[note.source] ?? note.source) : null
  return (
    <Modal title={note?.title ?? "加载中..."} onClose={onClose} width={720}>
      {error && <LoadError message={error} />}
      {note && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: colors.textMuted, flexWrap: "wrap" }}>
            <Badge tone="ink">{source}</Badge>
            <span>{formatShort(note.created_at, { withTime: false })}</span>
            {note.url && (
              <a href={note.url} target="_blank" rel="noreferrer" style={{ color: colors.ink }}>打开原文 ↗</a>
            )}
          </div>
          <NoteContent text={note.content} lines={8} fontSize={14} defaultOpen />
        </>
      )}
    </Modal>
  )
}

export default NoteViewerModal
