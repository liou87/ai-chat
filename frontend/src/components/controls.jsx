import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { DayPicker } from "react-day-picker"
import { zhCN } from "react-day-picker/locale/zh-CN"
import "react-day-picker/style.css"
import { useTheme } from "../ThemeContext"
import { radiusSm, radiusMd } from "../theme"

// 替代浏览器原生控件（下拉框、复选框、日期时间框）的一组表单控件：原生控件的弹层和空值文字（yyyy/mm/dd --:--）
// 跟着系统走，跟整体风格对不上。日历用 react-day-picker（无样式，配色在这里按主题覆盖），其余自己画。

const pad = (n) => String(n).padStart(2, "0")
const WEEKDAYS = "日一二三四五六"

function Chevron({ color }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

// 挂在 body 上的浮层，按触发按钮的位置用 fixed 定位：弹窗内容区是可滚动的，放在里面会被裁掉。
// 下方放不下就翻到上方；点外面、按 Esc、页面滚动都会关闭。Esc 在捕获阶段拦下，不让外层弹窗跟着关
export function Popover({ anchorRef, onClose, children }) {
  const { colors } = useTheme()
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    const a = anchorRef.current?.getBoundingClientRect()
    const el = ref.current
    if (!a || !el) return
    const h = el.offsetHeight
    const w = el.offsetWidth
    const below = a.bottom + 6
    const top = below + h > window.innerHeight - 8 && a.top - h - 6 > 8 ? a.top - h - 6 : below
    const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8))
    setPos({ top, left })
  }, [anchorRef])

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return
      onClose()
    }
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); anchorRef.current?.focus() }
    }
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onClose)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onClose)
    }
  }, [anchorRef, onClose])

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: 100,
        background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: radiusMd,
        boxShadow: "0 10px 32px rgba(0,0,0,0.16)", padding: 6, visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

// 触发按钮的外观跟输入框一致
function useTriggerStyle() {
  const { colors, inputStyle } = useTheme()
  return {
    ...inputStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left",
    background: colors.cardBg, minHeight: 34, boxSizing: "border-box",
  }
}

// 下拉选择。options: [{ value, label }]；value 用字符串，空串表示没选（显示 placeholder）。
// 键盘：触发按钮上按 ↓/Enter/空格打开，列表里 ↑↓ 移动、Enter 选中、Esc 关闭
export function Select({ value, onChange, options, placeholder = "请选择", ariaLabel, style }) {
  const { colors } = useTheme()
  const triggerStyle = useTriggerStyle()
  const anchorRef = useRef(null)
  const listRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [menuWidth, setMenuWidth] = useState(160)   // 列表至少跟触发按钮一样宽，打开时量一次
  const current = options.find(o => String(o.value) === String(value))

  useEffect(() => {
    if (!open) return
    const items = [...(listRef.current?.querySelectorAll("[role=option]") ?? [])]
    const selected = items.find(el => el.getAttribute("aria-selected") === "true")
    ;(selected ?? items[0])?.focus()
  }, [open])

  const onListKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const items = [...listRef.current.querySelectorAll("[role=option]")]
    const i = items.indexOf(document.activeElement)
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus()
  }
  const pick = (v) => { onChange(v); setOpen(false); anchorRef.current?.focus() }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={e => { setMenuWidth(Math.max(160, e.currentTarget.offsetWidth - 14)); setOpen(o => !o) }}
        onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setMenuWidth(Math.max(160, e.currentTarget.offsetWidth - 14)); setOpen(true) } }}
        style={{ ...triggerStyle, ...style }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: current ? colors.text : colors.textMuted }}>
          {current ? current.label : placeholder}
        </span>
        <Chevron color={colors.textMuted} />
      </button>
      {open && (
        <Popover anchorRef={anchorRef} onClose={() => setOpen(false)}>
          <div ref={listRef} role="listbox" aria-label={ariaLabel} onKeyDown={onListKey} style={{ minWidth: menuWidth, maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {options.map(o => {
              const selected = String(o.value) === String(value)
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(o.value)}
                  className="zx-option"
                  style={{
                    textAlign: "left", border: "none", borderRadius: radiusSm, padding: "7px 10px", cursor: "pointer",
                    fontSize: 13.5, fontFamily: "inherit", background: selected ? colors.inkSoft : undefined,
                    color: selected ? colors.ink : colors.text, fontWeight: selected ? 600 : 400,
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </Popover>
      )}
    </>
  )
}

// 复选框：真正的 input 还在（读屏和键盘照常用），只是透明叠在自己画的方框上
export function Checkbox({ checked, onChange, ariaLabel, label, size = 18 }) {
  const { colors } = useTheme()
  return (
    <label className="zx-check" style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", position: "relative", flexShrink: 0, fontSize: 13, color: colors.textSecondary }}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} />
      <span
        aria-hidden="true"
        style={{
          width: size, height: size, borderRadius: 5, boxSizing: "border-box", flexShrink: 0,
          border: `1.5px solid ${checked ? colors.ink : colors.border}`, background: checked ? colors.ink : colors.cardBg,
          display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.12s, border-color 0.12s",
        }}
      >
        {checked && (
          <svg width={size - 6} height={size - 6} viewBox="0 0 24 24" fill="none" stroke={colors.cardBg} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        )}
      </span>
      {label}
    </label>
  )
}

// "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:mm"（跟原来 date / datetime-local 控件的值格式一样，调用方不用改）
function parseValue(value) {
  if (!value) return null
  const [d, t] = value.split("T")
  const [y, m, day] = d.split("-").map(Number)
  const [hh, mm] = (t || "00:00").split(":").map(Number)
  return new Date(y, m - 1, day, hh, mm)
}
function toValue(date, withTime) {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return withTime ? `${d}T${pad(date.getHours())}:${pad(date.getMinutes())}` : d
}
function displayValue(date, withTime) {
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const d = `${sameYear ? "" : date.getFullYear() + "年"}${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAYS[date.getDay()]}`
  return withTime ? `${d} ${pad(date.getHours())}:${pad(date.getMinutes())}` : d
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

// 时间的一列（小时或分钟），选中项滚到可见
function TimeColumn({ values, selected, onPick, label }) {
  const { colors } = useTheme()
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "center" })
  }, [selected])
  return (
    <div ref={ref} role="listbox" aria-label={label} style={{ height: 248, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, paddingRight: 2 }}>
      {values.map(v => (
        <button
          key={v}
          type="button"
          role="option"
          aria-selected={v === selected}
          onClick={() => onPick(v)}
          className="zx-option"
          style={{
            border: "none", borderRadius: radiusSm, padding: "5px 10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
            fontVariantNumeric: "tabular-nums", background: v === selected ? colors.ink : undefined,
            color: v === selected ? colors.btnDarkText : colors.text,
          }}
        >
          {pad(v)}
        </button>
      ))}
    </div>
  )
}

// 日期（withTime=false）或日期 + 时间选择。选日子、选时间都立即生效；只选日期时选完就关。
// 还没有值时先点了时间，日期默认今天；先点了日期，时间默认 defaultTime
export function DateTimeInput({ value, onChange, withTime = true, placeholder, ariaLabel, defaultTime = "09:00" }) {
  const { colors } = useTheme()
  const triggerStyle = useTriggerStyle()
  const anchorRef = useRef(null)
  const [open, setOpen] = useState(false)
  const date = parseValue(value)
  const [defH, defM] = defaultTime.split(":").map(Number)

  const setDay = (day) => {
    if (!day) return
    const next = new Date(day)
    next.setHours(date ? date.getHours() : defH, date ? date.getMinutes() : defM, 0, 0)
    onChange(toValue(next, withTime))
    if (!withTime) { setOpen(false); anchorRef.current?.focus() }
  }
  const setTime = (h, m) => {
    const next = date ? new Date(date) : new Date()
    next.setHours(h, m, 0, 0)
    onChange(toValue(next, withTime))
  }

  return (
    <>
      <div style={{ position: "relative", display: "flex" }}>
        <button
          ref={anchorRef}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          style={{ ...triggerStyle, flex: 1, paddingRight: value ? 30 : undefined }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
          </svg>
          <span style={{ flex: 1, color: date ? colors.text : colors.textMuted }}>
            {date ? displayValue(date, withTime) : (placeholder ?? (withTime ? "选择日期和时间" : "选择日期"))}
          </span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="清除"
            title="清除"
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: colors.textMuted, fontSize: 15, lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <Popover anchorRef={anchorRef} onClose={() => setOpen(false)}>
          <div
            className="zx-daypicker"
            style={{ display: "flex", gap: 8, padding: "2px 4px", color: colors.text, fontSize: 13 }}
          >
            {/* 配色和尺寸变量要设在日历根元素上：库的样式表在 .rdp-root 上声明了默认值，设在外层会被盖掉 */}
            <DayPicker
              style={{
                "--rdp-accent-color": colors.ink, "--rdp-accent-background-color": colors.inkSoft,
                "--rdp-day-height": "34px", "--rdp-day-width": "34px", "--rdp-day_button-height": "32px", "--rdp-day_button-width": "32px",
                "--rdp-nav-height": "36px", "--rdp-nav_button-height": "30px", "--rdp-nav_button-width": "30px",
              }}
              mode="single"
              locale={zhCN}
              weekStartsOn={1}
              showOutsideDays
              selected={date ?? undefined}
              defaultMonth={date ?? new Date()}
              onSelect={setDay}
            />
            {withTime && (
              <div style={{ display: "flex", gap: 4, paddingTop: 36, borderLeft: `1px solid ${colors.borderLight}`, paddingLeft: 8 }}>
                <TimeColumn label="小时" values={HOURS} selected={date?.getHours()} onPick={h => setTime(h, date ? date.getMinutes() - (date.getMinutes() % 5) : 0)} />
                <TimeColumn label="分钟" values={MINUTES} selected={date ? date.getMinutes() - (date.getMinutes() % 5) : undefined} onPick={m => setTime(date ? date.getHours() : defH, m)} />
              </div>
            )}
          </div>
          {withTime && (
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 4px 2px", borderTop: `1px solid ${colors.borderLight}`, marginTop: 4 }}>
              <button type="button" onClick={() => { setOpen(false); anchorRef.current?.focus() }} style={{ border: "none", background: colors.btnDark, color: colors.btnDarkText, borderRadius: radiusSm, padding: "5px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                完成
              </button>
            </div>
          )}
        </Popover>
      )}
    </>
  )
}

// 搜索框：左边放大镜，右边有内容时出现清除按钮。停止输入 delay 毫秒后自动搜，回车立即搜；
// 清空就回到完整列表（onSearch 收到空串）
export function SearchInput({ value, onChange, onSearch, placeholder, ariaLabel, delay = 500, busy = false }) {
  const { colors, inputStyle } = useTheme()
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const change = (v) => {
    onChange(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onSearch(v.trim()), v.trim() ? delay : 0)
  }
  return (
    <div style={{ position: "relative", display: "flex", flex: 1, minWidth: 180 }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}>
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={e => change(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { clearTimeout(timer.current); onSearch(value.trim()) }
          if (e.key === "Escape" && value) { e.stopPropagation(); change("") }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        style={{ ...inputStyle, flex: 1, padding: "8px 32px 8px 34px", background: colors.cardBg }}
      />
      {busy ? (
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: colors.textMuted }}>…</span>
      ) : value && (
        <button
          type="button"
          onClick={() => change("")}
          aria-label="清除搜索"
          title="清除搜索"
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: colors.textMuted, fontSize: 15, lineHeight: 1, padding: 4 }}
        >
          ×
        </button>
      )}
    </div>
  )
}
