// themes.js — 主题定义（唯一权威来源）
// 所有主题色变量集中于此；新增主题只需在此追加一组变量，切换即自动渐变。
// index.css 中 :root / data-theme / @media 的静态定义与本文件同步维护，仅作无 JS 时的兜底。

export const THEMES = {
  light: {
    '--bg-primary': '#f8f9fa',
    '--bg-card': '#ffffff',
    '--bg-elevated': '#f5f5f8',
    '--text-primary': '#1a1a2e',
    '--text-secondary': '#3a3a4e',
    '--text-muted': '#4a4a5e',
    '--accent-1': '#6c5ce7',
    '--accent-1-light': '#8b7cf7',
    '--accent-1-hover': '#5a4bd6',
    '--accent-1-soft': 'rgba(108, 92, 231, 0.1)',
    '--accent-1-soft-strong': 'rgba(108, 92, 231, 0.15)',
    '--accent-1-border': 'rgba(108, 92, 231, 0.3)',
    '--accent-2': '#00cec9',
    '--accent-2-hover': '#00b894',
    '--accent-2-soft': 'rgba(0, 206, 201, 0.15)',
    '--danger': '#e74c3c',
    '--danger-hover': '#c0392b',
    '--danger-soft': 'rgba(231, 76, 60, 0.1)',
    '--danger-soft-strong': 'rgba(231, 76, 60, 0.15)',
    '--danger-border': 'rgba(231, 76, 60, 0.3)',
    '--white': '#ffffff',
    '--border-color': '#e2e2ef',
    '--neutral-soft': '#e8e8e8',
    '--neutral-soft-hover': '#d0d0d0',
    '--overlay': 'rgba(0, 0, 0, 0.5)',
    '--glow-accent': 'rgba(108, 92, 231, 0.08)',
    '--glow-accent-strong': 'rgba(108, 92, 231, 0.4)',
    '--glow-cyan': 'rgba(0, 206, 201, 0.06)',
    '--glow-cyan-strong': 'rgba(0, 206, 201, 0.4)',
    '--progress-gradient': 'linear-gradient(90deg, #6c5ce7, #00cec9)',
  },
  dark: {
    '--bg-primary': '#0f1014',
    '--bg-card': '#1a1b22',
    '--bg-elevated': '#23242e',
    '--text-primary': '#e8e8f0',
    '--text-secondary': '#b0b2c0',
    '--text-muted': '#7a7c8c',
    '--accent-1': '#7c6cf0',
    '--accent-1-light': '#9d8ffa',
    '--accent-1-hover': '#8a7bf5',
    '--accent-1-soft': 'rgba(124, 108, 240, 0.2)',
    '--accent-1-soft-strong': 'rgba(124, 108, 240, 0.28)',
    '--accent-1-border': 'rgba(124, 108, 240, 0.45)',
    '--accent-2': '#2ee6e0',
    '--accent-2-hover': '#3af0c0',
    '--accent-2-soft': 'rgba(46, 230, 224, 0.22)',
    '--danger': '#e0503f',
    '--danger-hover': '#ef6a55',
    '--danger-soft': 'rgba(240, 106, 88, 0.18)',
    '--danger-soft-strong': 'rgba(240, 106, 88, 0.26)',
    '--danger-border': 'rgba(240, 106, 88, 0.45)',
    '--white': '#ffffff',
    '--border-color': '#2e2f3a',
    '--neutral-soft': '#33343f',
    '--neutral-soft-hover': '#3d3e4b',
    '--overlay': 'rgba(0, 0, 0, 0.6)',
    '--glow-accent': 'rgba(124, 108, 240, 0.15)',
    '--glow-accent-strong': 'rgba(124, 108, 240, 0.5)',
    '--glow-cyan': 'rgba(46, 230, 224, 0.1)',
    '--glow-cyan-strong': 'rgba(46, 230, 224, 0.5)',
    '--progress-gradient': 'linear-gradient(90deg, #7c6cf0, #2ee6e0)',
  },
  // 黄金主题：字体/按钮变金色（背景保持当前主题不变，故不定义背景键）
  gold: {
    '--text-primary': '#b8860b',
    '--text-secondary': '#c9a45a',
    '--text-muted': '#a0863a',
    '--border-color': '#e8d28a',
    '--neutral-soft': '#f5e6b0',
    '--neutral-soft-hover': '#ecd89a',
    '--accent-1': '#d4a400',
    '--accent-1-light': '#f0c23a',
    '--accent-1-hover': '#b89100',
    '--accent-1-soft': 'rgba(212, 164, 0, 0.15)',
    '--accent-1-soft-strong': 'rgba(212, 164, 0, 0.22)',
    '--accent-1-border': 'rgba(212, 164, 0, 0.45)',
    '--accent-2': '#c99600',
    '--accent-2-hover': '#b88100',
    '--accent-2-soft': 'rgba(201, 150, 0, 0.18)',
    '--glow-accent': 'rgba(212, 164, 0, 0.12)',
    '--glow-accent-strong': 'rgba(212, 164, 0, 0.45)',
    '--glow-cyan': 'rgba(201, 150, 0, 0.08)',
    '--glow-cyan-strong': 'rgba(201, 150, 0, 0.4)',
    '--progress-gradient': 'linear-gradient(90deg, #d4a400, #f0c23a)',
  },
}

// 主题键集合（供插值引擎使用）
export const THEME_KEYS = Object.keys(THEMES.light)

// 解析当前主题模式（localStorage theme: light/dark/system）
export function detectThemeMode() {
  return localStorage.getItem('theme') || 'system'
}

// 判断某模式是否实际为深色
export function modeIsDark(mode) {
  return mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

// 解析颜色为 [r,g,b,a]，支持 hex / rgb / rgba
export function parseColor(str) {
  const s = (str || '').trim()
  const hex = s.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgba = s.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?/)
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] !== undefined ? Number(rgba[4]) : 1]
  return null
}
