// themes.js — 主题定义（唯一权威来源）
// 所有主题色变量集中于此；新增主题只需在此追加一组变量，切换即自动渐变。
// index.css 中 :root / data-theme / @media 的静态定义与本文件同步维护，仅作无 JS 时的兜底。
//
// ── Editorial（编辑杂志风）约定 ──
// 1. 只定义「基础令牌」（纸墨 + 灰度层级 + 中性底），不要定义 --bg-primary /
//    --text-primary / --accent-1 这类**别名**——它们由 index.css 用 var() 派生。
//    否则内联样式会盖掉别名链，黄金模式（纸墨反转）会失效。
// 2. 纯单色：任何色相都不允许出现，交互对比靠 --ink 与 --paper 的反转。
// 3. gold（黄金彩蛋·唯一彩色例外）也不在这里定义颜色：金色调色板在 index.css 的
//    [data-golden='1'] 中按明暗分别定义（浅色用暗金、深色用亮金），
//    这样一套彩蛋在两种模式下都可读。此处留空对象——主题引擎照常调用。

export const THEMES = {
  light: {
    '--paper': '#f9f8f6',
    '--ink': '#1c1c1c',
    '--ink-80': 'rgba(28, 28, 28, 0.8)',
    '--ink-60': 'rgba(28, 28, 28, 0.62)',
    '--ink-40': 'rgba(28, 28, 28, 0.4)',
    '--ink-20': 'rgba(28, 28, 28, 0.2)',
    '--ink-10': 'rgba(28, 28, 28, 0.1)',
    '--ink-04': 'rgba(28, 28, 28, 0.04)',
    '--ink-02': 'rgba(28, 28, 28, 0.02)',
    '--bg-elevated': '#f2f0eb',
    '--nav-bg': 'rgba(249, 248, 246, 0.9)',
    '--neutral-soft': '#f0eeea',
    '--neutral-soft-hover': '#e6e3dd',
    '--overlay': 'rgba(28, 28, 28, 0.6)',
    '--accent-1-hover': '#333333',
    '--accent-2-hover': '#333333',
    '--danger-hover': '#333333',
    '--hljs-keyword': '#7d4034',
    '--hljs-title': '#3f4a5a',
    '--hljs-const': '#2f4f4f',
    '--hljs-string': '#4a5d3a',
    '--hljs-builtin': '#6b4a2f',
    '--hljs-comment': '#8a857c',
    '--hljs-tag': '#5a5340',
    '--hljs-bullet': '#6b5a2f',
    '--hljs-add': '#3c5a34',
    '--hljs-add-bg': '#eef0e8',
    '--hljs-del': '#7d4034',
    '--hljs-del-bg': '#f4ece9',
  },
  // 夜幕：暖调单色（非冷黑 #0f1014，也非纯黑），墨色在其中反转为暖纸白
  dark: {
    '--paper': '#171614',
    '--ink': '#edeae4',
    '--ink-80': 'rgba(237, 234, 228, 0.8)',
    '--ink-60': 'rgba(237, 234, 228, 0.62)',
    '--ink-40': 'rgba(237, 234, 228, 0.42)',
    '--ink-20': 'rgba(237, 234, 228, 0.2)',
    '--ink-10': 'rgba(237, 234, 228, 0.12)',
    '--ink-04': 'rgba(237, 234, 228, 0.05)',
    '--ink-02': 'rgba(237, 234, 228, 0.03)',
    '--bg-elevated': '#1e1d1a',
    '--nav-bg': 'rgba(23, 22, 20, 0.9)',
    '--neutral-soft': '#232220',
    '--neutral-soft-hover': '#2c2b28',
    '--overlay': 'rgba(10, 10, 9, 0.72)',
    '--accent-1-hover': '#ffffff',
    '--accent-2-hover': '#ffffff',
    '--danger-hover': '#ffffff',
    '--hljs-keyword': '#d99a86',
    '--hljs-title': '#a9bdd6',
    '--hljs-const': '#9fc4c0',
    '--hljs-string': '#b3c79a',
    '--hljs-builtin': '#d6b48f',
    '--hljs-comment': '#8f8a80',
    '--hljs-tag': '#c9c2a8',
    '--hljs-bullet': '#cdb98a',
    '--hljs-add': '#b3c79a',
    '--hljs-add-bg': '#1f2a1c',
    '--hljs-del': '#d99a86',
    '--hljs-del-bg': '#2c1f1c',
  },
  // 黄金彩蛋：金色调色板见 index.css 的 [data-golden='1']（按明暗分别定义）
  gold: {},
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
