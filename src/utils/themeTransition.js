// utils/themeTransition.js — 主题切换渐变
// 浅色 ↔ 深色切换时，所有主题色从当前值逐帧线性插值到目标值（类似亮度调节器 0→255 的连续过渡）。

const LIGHT = {
  '--bg-primary': '#f8f9fa',
  '--bg-card': '#ffffff',
  '--bg-elevated': '#f5f5f8',
  '--text-primary': '#1a1a2e',
  '--text-secondary': '#3a3a4e',
  '--text-muted': '#4a4a5e',
  '--border-color': '#e2e2ef',
  '--neutral-soft': '#e8e8e8',
  '--neutral-soft-hover': '#d0d0d0',
}

const DARK = {
  '--bg-primary': '#0f1014',
  '--bg-card': '#1a1b22',
  '--bg-elevated': '#23242e',
  '--text-primary': '#e8e8f0',
  '--text-secondary': '#b0b2c0',
  '--text-muted': '#7a7c8c',
  '--border-color': '#2e2f3a',
  '--neutral-soft': '#33343f',
  '--neutral-soft-hover': '#3d3e4b',
}

const KEYS = Object.keys(LIGHT)
let rafId = null

function parseColor(str) {
  const s = (str || '').trim()
  const hex = s.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = s.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return [248, 249, 250] // 兜底：亮色
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function readCurrentValues() {
  const cs = getComputedStyle(document.documentElement)
  const out = {}
  for (const key of KEYS) {
    out[key] = parseColor(cs.getPropertyValue(key))
  }
  return out
}

/**
 * 浅色 ↔ 深色主题渐变切换。
 * @param {'light'|'dark'|'system'} mode - 目标主题模式
 * @param {number} [duration=600] - 动画时长 ms
 */
export function changeThemeWithTransition(mode, duration = 600) {
  if (rafId) cancelAnimationFrame(rafId)
  const target = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? DARK
    : LIGHT
  const from = readCurrentValues()
  const to = {}
  for (const key of KEYS) to[key] = parseColor(target[key])
  const root = document.documentElement
  const start = performance.now()

  const step = (now) => {
    const t = Math.min(1, (now - start) / duration)
    const ease = 1 - Math.pow(1 - t, 3) // easeOutCubic
    for (const key of KEYS) {
      const [r, g, b] = from[key]
      const [tr, tg, tb] = to[key]
      root.style.setProperty(key, `rgb(${lerp(r, tr, ease)},${lerp(g, tg, ease)},${lerp(b, tb, ease)})`)
    }
    if (t < 1) {
      rafId = requestAnimationFrame(step)
    } else {
      rafId = null
      // 到达目标后：应用静态主题并移除内联插值，交给 data-theme / 媒体查询接管
      if (mode === 'system') root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', mode)
      for (const key of KEYS) root.style.removeProperty(key)
    }
  }
  rafId = requestAnimationFrame(step)
}
