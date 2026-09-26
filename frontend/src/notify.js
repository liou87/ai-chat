// 提醒页里标记已读/删除之后发这个事件，顶部条幅监听它立刻重新检查，不用等 20 秒轮询
export const REMINDERS_CHANGED_EVENT = "reminders-changed"

// 提醒到期时的额外提示：浏览器系统通知 + 一声短提示音。
// 系统通知要用户授权；浏览器要求授权请求最好由用户点击触发，所以由提醒页的"开启系统通知"按钮
// 或者新建提醒时顺带请求，不在页面一加载就弹。

export function notificationSupported() {
  return typeof window !== "undefined" && "Notification" in window
}

export function notificationPermission() {
  return notificationSupported() ? Notification.permission : "unsupported"
}

export async function requestNotificationPermission() {
  if (!notificationSupported() || Notification.permission !== "default") return notificationPermission()
  try {
    return await Notification.requestPermission()
  } catch {
    return notificationPermission()
  }
}

export function showSystemNotification(title, body) {
  if (notificationPermission() !== "granted") return
  try {
    const n = new Notification(title, { body, tag: `reminder-${body}` })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // 个别环境（比如某些移动端浏览器）不支持直接 new Notification，忽略
  }
}

// 用 Web Audio 合成两声短"叮"，不用额外的音频文件。
// 浏览器要求页面有过用户交互才能出声，没交互过的话这里会静默失败，不影响条幅和系统通知。
let audioCtx = null
export function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === "suspended") audioCtx.resume()
    const t0 = audioCtx.currentTime
    ;[0, 0.18].forEach((offset, i) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = "sine"
      osc.frequency.value = i === 0 ? 880 : 1175
      gain.gain.setValueAtTime(0.0001, t0 + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.35)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(t0 + offset)
      osc.stop(t0 + offset + 0.4)
    })
  } catch {
    // 不支持 Web Audio 就算了
  }
}
