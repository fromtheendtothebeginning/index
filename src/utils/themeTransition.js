// utils/themeTransition.js — 通用主题渐变引擎
// 任何主题色变化（切换 / 换肤 / 新主题）都会从当前值逐帧线性插值到目标值，
// 自动产生平滑渐变动画。主题定义见 themes.js。

import { THEMES, modeIsDark, parseColor } from './themes'

let rafId = null

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function readCurrentValues(keys) {
  const cs = getComputedStyle(document.documentElement)
  const out = {}
  for (const key of keys) out[key] = parseColor(cs.getPropertyValue(key))
  return out
}

function formatRgba([r, g, b, a]) {
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')})`
}

/**
 * 将当前主题渐变过渡到目标主题（自动对全部变量插值）。
 * @param {string} name - THEMES 中的主题名（light / dark / 未来新主题）
 * @param {number} [duration=600] - 动画时长 ms
 */
export function applyTheme(name, duration = 600) {
  const target = THEMES[name]
  if (!target) return
  if (rafId) cancelAnimationFrame(rafId)
  const keys = Object.keys(target)
  const from = readCurrentValues(keys)
  const to = {}
  for (const key of keys) to[key] = parseColor(target[key])
  const root = document.documentElement
  const start = performance.now()

  const step = (now) => {
    const t = Math.min(1, (now - start) / duration)
    const ease = 1 - Math.pow(1 - t, 3) // easeOutCubic
    for (const key of keys) {
      const f = from[key] || [0, 0, 0, 1]
      const g = to[key] || [0, 0, 0, 1]
      root.style.setProperty(key, formatRgba([
        lerp(f[0], g[0], ease),
        lerp(f[1], g[1], ease),
        lerp(f[2], g[2], ease),
        f[3] + (g[3] - f[3]) * ease,
      ]))
    }
    if (t < 1) {
      rafId = requestAnimationFrame(step)
    } else {
      rafId = null
      root.setAttribute('data-theme', name)
      for (const key of keys) root.style.removeProperty(key)
    }
  }
  rafId = requestAnimationFrame(step)
}

/**
 * 浅色 ↔ 深色主题渐变切换（兼容旧调用，system 模式自动判断）。
 * @param {'light'|'dark'|'system'} mode - 目标主题模式
 * @param {number} [duration=600] - 动画时长 ms
 */
export function changeThemeWithTransition(mode, duration = 600) {
  if (mode === 'system') {
    const dark = modeIsDark('system')
    applyTheme(dark ? 'dark' : 'light', duration)
    document.documentElement.removeAttribute('data-theme')
    // 无 data-theme 时由 media 查询接管；此处显式应用目标色后移除内联，交由 CSS 兜底
    return
  }
  applyTheme(mode === 'dark' ? 'dark' : 'light', duration)
}

// 保留检测工具，供其它模块引用
export { modeIsDark }
