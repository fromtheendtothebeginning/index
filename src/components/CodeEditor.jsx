// CodeEditor.jsx — 博客 Markdown 编辑器（overlay 语法高亮 + 代码块智能按键 + 自动补全 + 原生撤销）
// 双层结构：底层 <pre> 用 highlight.js 渲染代码块高亮，上层 <textarea> 透明文字（保留光标），
// 精确对齐后实现"输入区代码块语法高亮"。编辑走 document.execCommand 以保留浏览器原生撤销栈。
import { useRef, useLayoutEffect, useState, useMemo, useEffect, useCallback } from 'react'
import { flushSync, createPortal } from 'react-dom'
import hljs from 'highlight.js/lib/common'
import {
  handleCodeFenceKey,
  isInCodeFence,
  getFenceLang,
  computeBracketPair,
} from '../utils/codeFenceKeys'
import {
  getCompletionCandidates,
  getPrefixBeforeCaret,
  getMdPrefixBeforeCaret,
  getFenceLangCandidates,
  getFenceLangInput,
  needsFenceClosure,
} from '../utils/completion'
import { t } from '../i18n'
import './CodeEditor.css'

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 计算 textarea 内光标（caret）的像素坐标（相对 .code-editor 容器）。
// 用一个与 textarea 样式一致的隐藏 mirror div 复制光标前文本，测量其位置。
let mirror = null
function getCaretCoordinates(ta, pos, container) {
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
  // 返回光标在【textarea 可视区】内的视口坐标（供 position:fixed 悬浮菜单使用）。
  // mirror 显示光标前全部内容（不滚动），rect.top 是内容绝对视口坐标；
  // 光标实际可视位置需减去 ta 的滚动偏移 scrollTop / scrollLeft。
  return {
    top: rect.top - ta.scrollTop,
    left: rect.left - ta.scrollLeft,
    height: lineH,
  }
}

// 将 Markdown 源码渲染为"代码块高亮 + 其余普通文本"的 HTML
// 关键：与 textarea 逐行像素级对齐——高亮层只改颜色，绝不改变行结构。
// 每一行单独输出为一个 <span> 行，行间用 \n 连接，与 textarea 的每一行一一对应。
function renderSourceHighlight(src) {
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

export default function CodeEditor({ value, onChange, placeholder, textareaRef }) {
  const taRef = useRef(null)
  const preRef = useRef(null)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)
  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 })

  // 自动补全状态
  const [completions, setCompletions] = useState([])
  const [menuIndex, setMenuIndex] = useState(-1)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const activeLangRef = useRef('')
  const prefixLenRef = useRef(0)
  const menuShownAtRef = useRef(0)

  const highlightHtml = useMemo(() => renderSourceHighlight(value || ''), [value])

  // 方向键选择项变化时，滚动菜单让当前选中项始终可见（选项在可视区内）
  useEffect(() => {
    if (menuIndex < 0 || !menuRef.current) return
    const items = menuRef.current.querySelectorAll('.code-editor-menu-item')
    const active = items[menuIndex]
    if (!active) return
    const menu = menuRef.current
    const ar = active.getBoundingClientRect()
    const mr = menu.getBoundingClientRect()
    if (ar.top < mr.top) {
      menu.scrollTop -= (mr.top - ar.top) + 4
    } else if (ar.bottom > mr.bottom) {
      menu.scrollTop += (ar.bottom - mr.bottom) + 4
    }
  }, [menuIndex])

  // 暴露 textarea ref（兼容外部调用）
  useEffect(() => {
    if (textareaRef) textareaRef.current = taRef.current
  }, [textareaRef])

  const handleScroll = (e) => {
    const el = e.target
    setScrollPos({ top: el.scrollTop, left: el.scrollLeft })
    if (preRef.current) {
      preRef.current.scrollTop = el.scrollTop
      preRef.current.scrollLeft = el.scrollLeft
    }
    // 输入引起的自动滚动（showMenu 刚执行后 400ms 内）不关闭菜单，避免菜单刚弹出就被关掉
    if (Date.now() - menuShownAtRef.current < 400) {
      return
    }
    // 用户主动滚动：菜单不再贴合光标，关闭避免误导
    hideMenu()
  }

  useLayoutEffect(() => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }, [scrollPos, highlightHtml])

// 应用 DOM 编辑动作（execCommand 保留 undo），并同步 React state
  const applyAction = useCallback((action, ta) => {
    if (!action) return
    if (action.type === 'skip') {
      // 仅移动光标（不编辑）
      ta.setSelectionRange(action.caret, action.caret)
      flushSync(() => {})
      return
    }
    if (action.type === 'insert') {
      document.execCommand('insertText', false, action.text)
    } else if (action.type === 'replace') {
      // 选择区间后插入替换文本（delete+insert 合并进一次 undo）
      ta.setSelectionRange(action.start, action.end)
      document.execCommand('insertText', false, action.text)
    }
    // 读回真实 DOM 值同步 state（受控组件 React 未感知 execCommand）
    const newVal = ta.value
    flushSync(() => onChange(newVal))
    // 若动作指定了光标位置，则定位到该处
    if (typeof action.caret === 'number') {
      ta.setSelectionRange(action.caret, action.caret)
    }
    return newVal
  }, [onChange])

  // 定位下拉框到光标附近（下方优先，超出视口则翻转上方并 clamp 在视口内）
  const showMenu = useCallback((cands, lang, prefixLen, ta) => {
    setCompletions(cands)
    setMenuIndex(0)
    activeLangRef.current = lang
    prefixLenRef.current = prefixLen
    const pos = ta.selectionStart ?? 0
    menuShownAtRef.current = Date.now()

    // 菜单始终显示在光标【下方】，跟随光标位置（不做翻转，避免"选择在下方、显示在上方"的割裂感）。
    // 空间不足时通过滚动 textarea + 页面让光标上移，尽量为菜单腾出下方空间。
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 23.8
    const menuH = Math.min(cands.length * 28 + 8, 240)
    const caretLine = ta.value.slice(0, pos).split('\n').length - 1
    const caretContentTop = caretLine * lineH
    // 菜单在光标下方所需空间（相对 ta 可视区）
    const needBelow = caretContentTop - ta.scrollTop + lineH + menuH + 8
    if (needBelow > ta.clientHeight && caretContentTop > ta.scrollTop) {
      // 优先滚动 textarea 使光标上移
      const desiredTop = Math.max(0, caretContentTop - ta.clientHeight / 3)
      ta.scrollTop = Math.min(desiredTop, ta.scrollHeight - ta.clientHeight)
      if (preRef.current) preRef.current.scrollTop = ta.scrollTop
    }

    const coord = getCaretCoordinates(ta, pos, wrapRef.current)
    // 页面滚动，让光标 + 菜单整体进入视口（屏幕跟着动），保证菜单在光标下方可见
    const below = coord.top + coord.height + 4
    const menuBottom = below + menuH
    if (menuBottom > window.innerHeight - 4 && below > window.innerHeight / 2) {
      window.scrollBy(0, Math.min(menuBottom - window.innerHeight + 20, window.innerHeight / 2))
    }
    const coord2 = getCaretCoordinates(ta, pos, wrapRef.current)
    const top = coord2.top + coord2.height + 4
    setMenuPos({ top, left: Math.max(4, coord2.left) })
  }, [])

  const hideMenu = useCallback(() => {
    setCompletions([])
    setMenuIndex(-1)
  }, [])

  // 输入后检测补全
  const handleChange = (e) => {
    const ta = taRef.current
    if (!ta) return
    onChange(e.target.value)
    const pos = ta.selectionStart ?? 0
    const text = e.target.value

    // 优先：围栏语言输入区（``` 后提示选语言）
    const fenceInput = getFenceLangInput(text, pos)
    if (fenceInput) {
      const rawCands = getFenceLangCandidates(fenceInput.prefix)
      // needsFenceClosure=true（下方无 ```）→ 补完整对；false（下方已有 ```）→ 只补语言
      const needClosure = needsFenceClosure(text, pos)
      const cands = rawCands.map(c => needClosure
        ? c
        : { ...c, insert: c.label })
      if (cands.length > 0) {
        showMenu(cands, 'lang', fenceInput.prefix.length, ta)
        return
      }
      hideMenu()
      return
    }

    if (!isInCodeFence(text, pos)) { hideMenu(); return }
    const lang = getFenceLang(text, pos)
    const isMd = lang === 'md' || lang === 'markdown' || lang === ''
    const prefix = isMd ? getMdPrefixBeforeCaret(text, pos) : getPrefixBeforeCaret(text, pos)
    // 前缀过短不弹（md 语法字符 1 个即可，python 标识符需 ≥2）
    if (!prefix || (isMd ? prefix.length < 1 : prefix.length < 2)) { hideMenu(); return }
    const cands = getCompletionCandidates(lang, prefix, text, pos)
    if (cands.length > 0) {
      showMenu(cands, lang, prefix.length, ta)
    } else {
      hideMenu()
    }
  }

  // 接受补全
  const acceptCompletion = useCallback(() => {
    const cand = completions[menuIndex]
    if (!cand) return false
    const ta = taRef.current
    if (!ta) return false
    const pos = ta.selectionStart
    // 删除前缀，插入补全内容
    const start = pos - prefixLenRef.current
    // 若补全是模块函数，前缀可能是 modName.fn，需处理
    const isModFunc = cand.type === 'modfunc'
    const delStart = isModFunc ? pos - prefixLenRef.current : start
    ta.setSelectionRange(delStart, pos)
    document.execCommand('insertText', false, cand.insert)
    // 围栏语言：光标落到语言后；若补全含闭合围栏则落到下一行（代码区首行）
    let caret = null
    if (cand.type === 'lang') {
      caret = cand.insert.includes('\n')
        ? delStart + cand.label.length + 1
        : delStart + cand.label.length
    }
    const newVal = ta.value
    flushSync(() => onChange(newVal))
    if (caret !== null) {
      ta.setSelectionRange(caret, caret)
    }
    hideMenu()
    return true
  }, [completions, menuIndex, onChange, hideMenu])

  const handleKeyDown = (e) => {
    const ta = taRef.current
    if (!ta) return

    // 下拉框打开时处理方向键/Tab/Enter/Esc
    if (completions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex(i => (i + 1) % completions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex(i => (i - 1 + completions.length) % completions.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (acceptCompletion()) return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        if (acceptCompletion()) return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        hideMenu()
        return
      }
      // 左/右方向键：先让光标正常移动，下一帧再取消弹窗（避免 React 重渲染重置光标）
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        requestAnimationFrame(() => hideMenu())
        return
      }
    }

    // 括号补全（仅代码块内）：输入开括号/引号时自动补闭合符
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const pos = ta.selectionStart ?? 0
      const end = ta.selectionEnd ?? pos
      if (isInCodeFence(value, pos)) {
        const bracket = computeBracketPair(value, pos, end, e.key)
        if (bracket) {
          e.preventDefault()
          applyAction(bracket, ta)
          hideMenu()
          return
        }
      }
    }

    // 代码块智能按键（execCommand 保留撤销）
    const action = handleCodeFenceKey(e, value)
    if (action) {
      e.preventDefault()
      applyAction(action, ta)
      hideMenu()
      return
    }
  }

  return (
    <div className="code-editor" ref={wrapRef}>
      <pre
        ref={preRef}
        className="code-editor-hl"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: highlightHtml }}
      />
      <textarea
        ref={taRef}
        className="code-editor-ta"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        onBlur={hideMenu}
        spellCheck={false}
      />
      {completions.length > 0 && createPortal(
        <div
          className="code-editor-menu"
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {completions.map((c, i) => (
            <div
              key={c.label + i}
              className={`code-editor-menu-item ${i === menuIndex ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                setMenuIndex(i)
                acceptCompletion()
              }}
            >
              <span className="code-editor-menu-label">{c.label}</span>
              <span className="code-editor-menu-type">{c.type}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}