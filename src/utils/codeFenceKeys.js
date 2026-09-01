// codeFenceKeys.js — 博客编辑器内嵌代码块的智能按键
// 仅在 Markdown 围栏代码块（``` 内）生效：
//  - Enter 自动缩进（继承当前行缩进；花括号语言行尾 `{` 额外 +1 级；python 冒号后 +1、break/return 等 -1）
//  - Tab   插入 4 空格缩进（多行选区则整块右移）
//  - Backspace 按缩进单元（4 空格）成块删除
//  - Ctrl/Cmd + / 切换本行（或选区行）注释，按语言选择注释符
//
// 返回值：{ type: 'insert'|'replace'|'delete', start, end, text } 描述一个 DOM 编辑动作，
// 由 CodeEditor 用 document.execCommand 执行，从而保留浏览器原生撤销栈（Ctrl+Z 可撤回）。
// 也可返回 null 表示不拦截（交默认行为）。

export const INDENT_UNIT = '    '  // 默认一个 tab = 4 空格

// 单行注释语言映射
const LINE_COMMENT = {
  js: '//', jsx: '//', ts: '//', tsx: '//', javascript: '//', typescript: '//',
  java: '//', c: '//', cpp: '//', 'c++': '//', cs: '//', 'c#': '//', go: '//',
  rust: '//', swift: '//', kotlin: '//', php: '//', dart: '//', scala: '//',
  python: '#', py: '#', bash: '#', sh: '#', shell: '#', zsh: '#', ruby: '#',
  yaml: '#', yml: '#', perl: '#', ini: '#', toml: '#', dockerfile: '#',
  sql: '--', mysql: '--', postgresql: '--',
  css: '/* */', scss: '/* */', less: '/* */',
  html: '<!-- -->', xml: '<!-- -->', vue: '<!-- -->', svg: '<!-- -->',
  markdown: '<!-- -->', md: '<!-- -->',
}
const DEFAULT_COMMENT = '//'
const BRACE_LANGS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'java', 'c', 'cpp', 'c++',
  'cs', 'c#', 'go', 'rust', 'swift', 'kotlin', 'php', 'dart', 'scala', 'css', 'scss', 'less',
])

function getLineInfo(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1
  let end = text.indexOf('\n', pos)
  if (end === -1) end = text.length
  return { start, end, content: text.slice(start, end) }
}

function leadingWs(s) {
  const m = s.match(/^[ \t]*/)
  return m ? m[0] : ''
}

export function isFenceLine(line) {
  return /^```/.test(line.trim())
}

// 判断光标所在行是否是围栏标记行（用于让围栏行不触发缩进）
export function isCodeFenceLine(text, pos) {
  const { content } = getLineInfo(text, pos)
  return isFenceLine(content)
}

// 光标是否位于围栏代码块内部（统计光标前完整行的 ``` 数）
export function isInCodeFence(text, pos) {
  const before = text.slice(0, pos)
  const lines = before.split('\n')
  let fences = 0
  for (let i = 0; i < lines.length - 1; i++) {
    if (isFenceLine(lines[i])) fences++
  }
  return fences % 2 === 1
}

// 当前所在代码块的语言（无围栏/未闭合返回 ''）
// 只统计光标前的【完整行】（排除当前未完成行，与 isInCodeFence 一致），
// 避免把光标正在输入/停留的 ``` 行误判为闭合围栏而清空语言。
export function getFenceLang(text, pos) {
  const before = text.slice(0, pos)
  const lines = before.split('\n')
  let lang = ''
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].trim().match(/^```(\S*)/)
    if (m) {
      if (!lang) lang = m[1] || ''
      else lang = ''
    }
  }
  return lang
}

function commentFor(lang) {
  const l = (lang || '').trim().toLowerCase()
  return LINE_COMMENT[l] || DEFAULT_COMMENT
}

// Python 块内减缩进行：此行以这些关键字结尾时，下一行回车回到上一缩进级别
const PY_DEDENT_RE = /^\s*(break|continue|return|pass|raise)\b.*$/

// 处理 Enter：返回 { value, caret } 语义的新位置描述（由 CodeEditor 转换）
export function computeEnter(text, selStart, selEnd, lang) {
  const { content } = getLineInfo(text, selStart)
  let indent = leadingWs(content)
  const langL = (lang || '').toLowerCase()
  const trimmed = content.trimEnd()

  if (langL === 'python' || langL === 'py') {
    if (/:\s*$/.test(trimmed) && !/^\s*['"].*:\s*['"]$/.test(trimmed)) {
      indent += INDENT_UNIT
    } else if (PY_DEDENT_RE.test(trimmed)) {
      if (indent.length >= INDENT_UNIT.length) {
        indent = indent.slice(0, indent.length - INDENT_UNIT.length)
      } else {
        indent = ''
      }
    }
    return { type: 'insert', text: '\n' + indent }
  }

  if (BRACE_LANGS.has(langL) && trimmed.endsWith('{')) {
    indent += INDENT_UNIT
  }
  return { type: 'insert', text: '\n' + indent }
}

// 处理 Tab：单点插 4 空格；多行选区整块右移
export function computeTab(text, selStart, selEnd) {
  const lineStart = getLineInfo(text, selStart).start
  const lineEnd = getLineInfo(text, selEnd).end
  const singlePoint = selStart === selEnd
  if (singlePoint) {
    return { type: 'insert', text: INDENT_UNIT }
  }
  // 多行：对每行前插 4 空格（替换整个选区块）
  const block = text.slice(lineStart, lineEnd)
  const indented = block
    .split('\n')
    .map((l) => (l.trim() === '' ? l : INDENT_UNIT + l))
    .join('\n')
  return { type: 'replace', start: lineStart, end: lineEnd, text: indented }
}

// 处理 Backspace：光标前恰为一个缩进单元（4 空格）时删整个单元；否则不拦截
export function computeBackspace(text, selStart, selEnd) {
  if (selStart !== selEnd) return null
  const pos = selStart
  const before = text.slice(0, pos)
  if (before.endsWith(INDENT_UNIT)) {
    return { type: 'replace', start: pos - INDENT_UNIT.length, end: pos, text: '' }
  }
  return null
}

// 切换单行注释
function toggleLine(line, marker) {
  if (marker.includes(' ')) {
    const [open, close] = marker.split(' ')
    const m = line.trim().match(new RegExp(`^${open}(.*)${close}$`))
    if (m) {
      const inner = m[1].replace(/^\s+|\s+$/g, '')
      return leadingWs(line) + inner
    }
    return leadingWs(line) + open + ' ' + line.trim() + ' ' + close
  }
  const trimmed = line.trim()
  if (trimmed.startsWith(marker)) {
    return leadingWs(line) + trimmed.slice(marker.length).replace(/^ /, '')
  }
  return leadingWs(line) + marker + ' ' + trimmed
}

// 处理 Ctrl/Cmd+/：对选区覆盖的所有行切换注释
export function computeCommentToggle(text, selStart, selEnd, lang) {
  const marker = commentFor(lang)
  const first = getLineInfo(text, selStart).start
  const last = getLineInfo(text, selEnd).end
  const block = text.slice(first, last)
  const toggled = block.split('\n').map((l) => toggleLine(l, marker)).join('\n')
  return { type: 'replace', start: first, end: last, text: toggled }
}

// 括号补全对：开/闭字符（反引号除外——它是 md 围栏语法，不做括号补全）
const BRACKET_PAIRS = {
  '(': ')', '[': ']', '{': '}',
  '"': '"', "'": "'",
}
// 反向映射：闭括号 → 开括号
const CLOSE_TO_OPEN = {
  ')': '(', ']': '[', '}': '{',
  '"': '"', "'": "'",
}

// 括号补全：输入开括号/引号时自动补闭合符，光标落在中间。
// 输入闭括号时，若光标后已是同对闭合符（由补全提供），则跳过（仅右移光标），不重复插入。
// 返回 { type, text, caret? }；caret 为相对结果文本的光标偏移（绝对位置，供 applyAction 用）。
// 返回 null 表示不拦截（正常输入）。
export function computeBracketPair(text, selStart, selEnd, inputChar) {
  const close = BRACKET_PAIRS[inputChar]

  // 输入的是闭括号/闭合引号：若光标后已是同字符则跳过，避免重复插入
  if (close === undefined && CLOSE_TO_OPEN[inputChar] !== undefined) {
    if (selStart !== selEnd) return null
    if (text[selStart] === inputChar) {
      return { type: 'skip', caret: selStart + 1 }
    }
    return null
  }

  if (!close) return null

  // 有选中文本 → 用括号包裹选区
  if (selStart !== selEnd) {
    const selected = text.slice(selStart, selEnd)
    const result = inputChar + selected + close
    return { type: 'replace', start: selStart, end: selEnd, text: result, caret: selStart + inputChar.length + selected.length }
  }

  // 无选区：光标后已是同对闭合符 → 跳过（仅右移光标，不重复插入）
  const nextChar = text[selStart]
  if (nextChar === close) {
    return { type: 'skip', caret: selStart + 1 }
  }

  // 常规：插入 open+close，光标在中间
  return { type: 'insert', text: inputChar + close, caret: selStart + 1 }
}

// 统一入口：返回一个 DOM 编辑动作对象，或 null（不拦截）
// { type:'insert', text }：在当前光标处插入 text（selection 替换）
// { type:'replace', start, end, text }：替换 [start,end) 区间为 text
export function handleCodeFenceKey(e, text) {
  const pos = e.target.selectionStart ?? 0
  const end = e.target.selectionEnd ?? pos
  if (!isInCodeFence(text, pos)) return null
  const lang = getFenceLang(text, pos)

  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    return computeEnter(text, pos, end, lang)
  }
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    return computeTab(text, pos, end)
  }
  if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const r = computeBackspace(text, pos, end)
    if (r) {
      e.preventDefault()
      return r
    }
    return null
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault()
    return computeCommentToggle(text, pos, end, lang)
  }
  return null
}