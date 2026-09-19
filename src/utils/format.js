// format.js — 日期展示统一收口（zh-CN）。s 为空返回 ''，非法日期原样返回。

function format(s, render) {
  if (!s) return ''
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : render(d)
}

// 完整日期时间（含秒）：2026/9/19 14:30:25
export const fmtDateTime = (s) => format(s, d => d.toLocaleString('zh-CN'))

// 年月日 + 时分（月/日 2 位）：2026/09/19 14:30
export const fmtDateTimeMinute = (s) => format(s, d => d.toLocaleString('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}))

// 长日期：2026年9月19日
export const fmtDateLong = (s) => format(s, d => d.toLocaleDateString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric',
}))

// 短日期：2026/9/19
export const fmtDate = (s) => format(s, d => d.toLocaleDateString('zh-CN'))

// 默认 locale 完整日期时间（跟随浏览器语言设置）
export const fmtLocaleDateTime = (s) => format(s, d => d.toLocaleString())
