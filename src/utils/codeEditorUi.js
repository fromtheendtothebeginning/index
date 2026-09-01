// codeEditorUi.js — CodeEditor 的纯函数/无 React 依赖的 UI 辅助
// 拆出组件内联的逻辑，便于单测并保持组件薄。
import hljs from 'highlight.js/lib/common'

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 计算 textarea 内光标（caret）的像素坐标（视口坐标，供 position:fixed 悬浮菜单使用）。
// 用一个与 textarea 样式一致的隐藏 mirror div 复制光标前文本，测量其位置；
// mirror 显示光标前全部内容（不滚动），rect.top 是内容绝对视口坐标，
// 光标实际可视位置需减去 ta 的滚动偏移 scrollTop / scrollLeft。
let mirror = null
export function getCaretCoordinates(ta, pos, container) {
  if (!mirror) {
    mirror = document.createElement('div')
    mirror.setAttribute('aria-hidden', 'true')
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.top = '0'
    mirror.style.left = '0'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordWrap = 'break-word'
    mirror.style.pointerEvents = 'none'
    mirror.style.overflow = 'hidden'
    mirror.style.textAlign = 'left'
    container.appendChild(mirror)
  }
  const cs = getComputedStyle(ta)
  const styles = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'boxSizing', 'textTransform', 'wordSpacing', 'tabSize',
  ]
  for (const s of styles) mirror.style[s] = cs[s]
  mirror.style.width = cs.width
  mirror.style.height = 'auto'
  const text = ta.value.slice(0, pos)
  const marker = '\u200b'
  mirror.textContent = text
  const span = document.createElement('span')
  span.textContent = marker
  mirror.appendChild(span)
  const rect = span.getBoundingClientRect()
  const lineH = parseFloat(cs.lineHeight) || (parseInt(cs.fontSize, 10) * 1.7)
  return {
    top: rect.top - ta.scrollTop,
    left: rect.left - ta.scrollLeft,
    height: lineH,
  }
}

// 将 Markdown 源码渲染为"代码块高亮 + 其余普通文本"的 HTML
// 关键：与 textarea 逐行像素级对齐——高亮层只改颜色，绝不改变行结构。
// 每一行单独输出为一个 <span> 行，行间用 \n 连接，与 textarea 的每一行一一对应。
export function renderSourceHighlight(src) {
  const lines = src.split('\n')
  const outRows = []
  let i = 0
  let inFence = false
  let fenceLang = ''
  const buf = []

  const flushCode = () => {
    if (buf.length === 0) return
    const code = buf.join('\n')
    let html
    try {
      if (fenceLang && hljs.getLanguage(fenceLang)) {
        html = hljs.highlight(code, { language: fenceLang, ignoreIllegals: true }).value
      } else {
        html = hljs.highlightAuto(code).value
      }
    } catch {
      html = esc(code)
    }
    // 整体高亮后按行拆分，保证与 textarea 行数一致
    const hlRows = html.split('\n')
    for (let r = 0; r < buf.length; r++) {
      outRows.push(`<span class="code-editor-fence-line${fenceLang ? ' has-lang' : ''}">${hlRows[r] || ''}</span>`)
    }
    buf.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]
    const fenceMatch = line.match(/^```(\S*)\s*$/)
    if (fenceMatch) {
      if (!inFence) {
        outRows.push(`<span>${esc(line)}</span>`)
        inFence = true
        fenceLang = fenceMatch[1] || ''
        i++
        continue
      } else {
        flushCode()
        inFence = false
        fenceLang = ''
        outRows.push(`<span>${esc(line)}</span>`)
        i++
        continue
      }
    }
    if (inFence) {
      buf.push(line)
    } else {
      outRows.push(`<span>${esc(line)}</span>`)
    }
    i++
  }
  flushCode()
  return outRows.join('\n')
}