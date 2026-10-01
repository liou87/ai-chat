import { useEffect, useRef, useState } from "react"
import { apiFetch } from "../api"
import { useTheme } from "../ThemeContext"
import { formatShort } from "../datetime"
import LoadError from "./LoadError"
import { PageHeader, Badge } from "./ui"

const TYPE_LABEL = { llm: "模型调用", tool_call: "调用工具", tool_result: "工具结果", final: "最终回复" }
const PAYLOAD_PREVIEW = 1200   // 工具结果可能很长（比如检索返回的片段），展开前只显示这么多字

const fmtMs = (ms) => ms == null ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
const fmtTokens = (n) => !n ? "" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

// 执行轨迹（类似 LangSmith / Langfuse 的单轮 trace 视图）：每一轮对话里知行调用了哪些工具、参数和结果、
// 每一步花了多久、用了多少 token。可以只看出错的、按工具筛；从聊天里点"查看轨迹"会直接展开对应那一轮
function TracePanel({ target, onTargetConsumed }) {
  const { colors, inputStyle, buttonStyle, panelCardStyle } = useTheme()
  const [turns, setTurns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [tool, setTool] = useState("")
  const [knownTools, setKnownTools] = useState([])
  const [openKey, setOpenKey] = useState(null)     // "会话id-轮次"

  const fetchTurns = async () => {
    setLoading(true)
    try {
      const list = await apiFetch("/traces", { params: { errors_only: errorsOnly || null, tool: tool || null } })
      setTurns(list)
      // 工具下拉的选项：见过的工具都留着，筛选之后列表变短也不会丢选项
      setKnownTools(prev => [...new Set([...prev, ...list.flatMap(t => t.tools)])].sort())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTurns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorsOnly, tool])

  // 从聊天里跳过来：展开那一轮（不在当前列表里也能单独展开）
  useEffect(() => {
    if (target) {
      setOpenKey(`${target.sessionId}-${target.turnIndex}`)
      onTargetConsumed()
    }
  }, [target, onTargetConsumed])

  const targetKey = openKey
  const inList = turns.some(t => `${t.session_id}-${t.turn_index}` === targetKey)

  return (
    <div>
      <PageHeader
        eyebrow="每一轮对话里知行做了什么：调用了哪些工具、花了多久、用了多少 token"
        title="执行轨迹"
        action={<button onClick={fetchTurns} style={buttonStyle}>刷新</button>}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: colors.textSecondary, cursor: "pointer" }}>
          <input type="checkbox" checked={errorsOnly} onChange={e => setErrorsOnly(e.target.checked)} style={{ accentColor: colors.ink }} />
          只看出错的
        </label>
        <select value={tool} onChange={e => setTool(e.target.value)} aria-label="按工具筛选" style={{ ...inputStyle, width: "auto", fontSize: 13 }}>
          <option value="">全部工具</option>
          {knownTools.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: colors.textMuted }}>最近 {turns.length} 轮</span>
      </div>

      {error && <LoadError message={error} onRetry={fetchTurns} />}
      {loading && turns.length === 0 && <div style={{ color: colors.textMuted }}>加载中...</div>}
      {!loading && !error && turns.length === 0 && (
        <div style={{ ...panelCardStyle, padding: "24px", color: colors.textMuted, fontSize: 14 }}>
          {errorsOnly || tool ? "没有符合条件的轮次" : "还没有对话记录"}
        </div>
      )}

      {/* 从聊天跳来的那一轮如果不在当前筛选结果里，单独放在最上面 */}
      {targetKey && !inList && (
        <TurnCard
          key={targetKey}
          turn={null}
          turnKey={targetKey}
          open
          onToggle={() => setOpenKey(null)}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.map(t => {
          const key = `${t.session_id}-${t.turn_index}`
          return <TurnCard key={key} turn={t} turnKey={key} open={openKey === key} onToggle={() => setOpenKey(k => k === key ? null : key)} />
        })}
      </div>
    </div>
  )
}

function TurnCard({ turn, turnKey, open, onToggle }) {
  const { colors, panelCardStyle } = useTheme()
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const ref = useRef(null)
  const [sessionId, turnIndex] = turnKey.split("-").map(Number)

  useEffect(() => {
    if (!open || detail) return
    apiFetch(`/traces/${sessionId}/${turnIndex}`).then(setDetail).catch(e => setError(e.message))
  }, [open, detail, sessionId, turnIndex])

  useEffect(() => {
    if (open && ref.current) ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [open])

  const t = turn ?? detail
  return (
    <div ref={ref} style={{ ...panelCardStyle, padding: "14px 18px", marginBottom: turn ? 0 : 10, borderColor: open ? colors.ink : colors.cardBorder }}>
      <button onClick={onToggle} aria-expanded={open} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
        {t ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.question || "（没有找到提问）"}
              </span>
              {t.has_error && <Badge tone="danger">出错</Badge>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
              <span>{t.session_title} · 第 {Math.floor(t.turn_index / 2) + 1} 轮 · {formatShort(t.started_at)}</span>
              <span>· {fmtMs(t.duration_ms)}</span>
              {t.prompt_tokens > 0 && <span>· {fmtTokens(t.prompt_tokens + t.completion_tokens)} tokens</span>}
              <span>· {t.llm_calls} 次模型调用</span>
              {t.tools.map(name => <Badge key={name} tone="ink">{name}</Badge>)}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 14, color: colors.textMuted }}>{error ? `加载失败：${error}` : "加载中…"}</div>
        )}
      </button>

      {open && detail && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${colors.borderLight}` }}>
          {detail.steps.map((s, i) => <StepRow key={i} step={s} last={i === detail.steps.length - 1} />)}
        </div>
      )}
      {open && error && turn && <div style={{ marginTop: 8 }}><LoadError message={error} /></div>}
    </div>
  )
}

function StepRow({ step, last }) {
  const { colors } = useTheme()
  const [showAll, setShowAll] = useState(false)
  // 每一步要展示的内容：模型调用显示它决定调哪些工具；工具调用显示参数；工具结果显示返回；最终回复显示正文
  const body = step.type === "tool_call" ? step.payload.args
    : step.type === "tool_result" ? step.payload.result
    : step.type === "final" ? step.payload.content
    : null
  const text = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body, null, 2)
  const long = text.length > PAYLOAD_PREVIEW
  const llmNote = step.type === "llm"
    ? (step.payload.tool_calls ? `决定调用：${step.payload.tool_calls.join("、")}` : "生成回复")
    : null
  const dot = step.is_error ? colors.danger : step.type === "llm" ? colors.ink : step.type === "final" ? colors.text : colors.textMuted

  return (
    <div style={{ display: "flex", gap: 12 }}>
      {/* 左侧时间线：圆点 + 竖线 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 10, flexShrink: 0 }}>
        <div style={{ width: 9, height: 9, borderRadius: 5, background: dot, marginTop: 5 }} />
        {!last && <div style={{ flex: 1, width: 1, background: colors.borderLight, marginTop: 3 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: step.is_error ? colors.danger : colors.text }}>
            {TYPE_LABEL[step.type] ?? step.type}{step.name ? ` · ${step.name}` : ""}
          </span>
          {llmNote && <span style={{ fontSize: 12.5, color: colors.textSecondary }}>{llmNote}</span>}
          <span style={{ marginLeft: "auto", fontSize: 12, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
            {fmtMs(step.duration_ms)}
            {step.prompt_tokens != null && ` · 输入 ${fmtTokens(step.prompt_tokens)} / 输出 ${fmtTokens(step.completion_tokens)}`}
          </span>
        </div>
        {text && (
          <pre style={{ margin: "6px 0 0", padding: "8px 10px", borderRadius: 6, background: colors.neutralSoft, color: colors.textSecondary, fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: showAll ? undefined : 260, overflow: "auto", fontFamily: "ui-monospace, Consolas, monospace" }}>
            {showAll || !long ? text : `${text.slice(0, PAYLOAD_PREVIEW)}…`}
          </pre>
        )}
        {long && (
          <button onClick={() => setShowAll(v => !v)} style={{ border: "none", background: "none", padding: 0, marginTop: 4, cursor: "pointer", fontSize: 12, color: colors.ink }}>
            {showAll ? "收起" : `展开全部（${text.length.toLocaleString()} 字）`}
          </button>
        )}
      </div>
    </div>
  )
}

export default TracePanel
