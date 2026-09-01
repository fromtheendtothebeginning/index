// completion.js — 代码块自动补全
// - Python：关键字 + 内置 + 标准库模块 + 常用模块函数
// - Markdown：常用语法片段提示
import pythonData from './pythonCompletion.json' with { type: 'json' }

// 常用 Markdown 片段
const MD_SNIPPETS = [
  { label: '代码块', insert: '```\n\n```', keyword: '```' },
  { label: 'Python 代码块', insert: '```python\n\n```', keyword: '```py' },
  { label: 'JS 代码块', insert: '```js\n\n```', keyword: '```js' },
  { label: '图片', insert: '![alt](url)', keyword: '![' },
  { label: '链接', insert: '[text](url)', keyword: '[' },
  { label: '标题1', insert: '# ', keyword: '#' },
  { label: '标题2', insert: '## ', keyword: '##' },
  { label: '标题3', insert: '### ', keyword: '###' },
  { label: '粗体', insert: '**bold**', keyword: '**' },
  { label: '斜体', insert: '*italic*', keyword: '*' },
  { label: '删除线', insert: '~~text~~', keyword: '~~' },
  { label: '行内代码', insert: '`code`', keyword: '`' },
  { label: '引用', insert: '> ', keyword: '>' },
  { label: '无序列表', insert: '- ', keyword: '- ' },
  { label: '有序列表', insert: '1. ', keyword: '1.' },
  { label: '任务列表', insert: '- [ ] ', keyword: '- [ ]' },
  { label: '表格', insert: '| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |', keyword: '|' },
  { label: '分隔线', insert: '---\n', keyword: '---' },
]

// 补全候选结构：{ label, insert, type }
// type: 'keyword' | 'builtin' | 'module' | 'modfunc' | 'md'

// 常用代码块语言（围栏 ``` 后提示选语言）
// insert 为补全文本：语言 + 空行 + 闭合围栏；光标落在语言后（代码区首行）
// 当文档下方已有可匹配的闭合围栏时（见 CodeEditor），CodeEditor 会改写为纯语言 insert。
const FENCE_LANGS = [
  { label: 'python', type: 'lang', insert: 'python\n\n```' },
  { label: 'js', type: 'lang', insert: 'js\n\n```' },
  { label: 'ts', type: 'lang', insert: 'ts\n\n```' },
  { label: 'java', type: 'lang', insert: 'java\n\n```' },
  { label: 'c', type: 'lang', insert: 'c\n\n```' },
  { label: 'cpp', type: 'lang', insert: 'cpp\n\n```' },
  { label: 'go', type: 'lang', insert: 'go\n\n```' },
  { label: 'rust', type: 'lang', insert: 'rust\n\n```' },
  { label: 'html', type: 'lang', insert: 'html\n\n```' },
  { label: 'css', type: 'lang', insert: 'css\n\n```' },
  { label: 'json', type: 'lang', insert: 'json\n\n```' },
  { label: 'bash', type: 'lang', insert: 'bash\n\n```' },
  { label: 'sh', type: 'lang', insert: 'sh\n\n```' },
  { label: 'sql', type: 'lang', insert: 'sql\n\n```' },
  { label: 'md', type: 'lang', insert: 'md\n\n```' },
  { label: 'markdown', type: 'lang', insert: 'markdown\n\n```' },
  { label: 'yaml', type: 'lang', insert: 'yaml\n\n```' },
  { label: 'xml', type: 'lang', insert: 'xml\n\n```' },
  { label: 'text', type: 'lang', insert: 'text\n\n```' },
]

// 获取围栏语言候选（prefix 为空则全部，否则前缀过滤）
export function getFenceLangCandidates(prefix) {
  const p = (prefix || '').toLowerCase()
  return FENCE_LANGS.filter(l => l.label.startsWith(p))
}

// 判断当前开启围栏是否需要在补全时自带闭合围栏。
// 配对计算：看光标之后【第一个】围栏标记——
//  - 若为无语言闭合 ```（可作为当前围栏的配对闭合）→ 复用，不补闭合（return false）
//  - 若为有语言开启 ```xxx（是另一个代码块，不属当前）或无围栏 → 补完整对（return true）
export function needsFenceClosure(text, pos) {
  const afterLines = text.slice(pos).split('\n')
  for (const l of afterLines) {
    const t = l.trim()
    if (!/^```/.test(t)) continue
    // 找到第一个围栏标记
    return !/^```\s*$/.test(t)
  }
  return true
}

// 检测光标是否处于"围栏语言输入区"：当前行以 ``` 开头且这是【开启】围栏（非闭合）
// 返回 { prefix }（``` 后的语言前缀）或 null
// 若光标前已有未闭合围栏（在代码块内），当前 ``` 是闭合标记，不应弹语言补全。
export function getFenceLangInput(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const line = text.slice(lineStart, pos)
  const m = line.match(/^```(\S*)$/)
  if (!m) return null
  // 统计光标前完整行的 ``` 数：偶数=开启围栏，奇数=闭合围栏
  const before = text.slice(0, lineStart)
  let fences = 0
  for (const l of before.split('\n')) {
    if (/^```/.test(l.trim())) fences++
  }
  if (fences % 2 === 1) return null // 在代码块内 → 这是闭合围栏
  return { prefix: m[1] }
}

// 模糊匹配：前缀匹配
function matches(prefix, word) {
  return word.startsWith(prefix)
}

// 从当前代码块内提取用户已定义的标识符（变量/函数/类名/导入名）
// 作为自动补全候选（type:'var'）。仅提取"定义位置"的标识符，避免把方法名等误当变量。
export function extractPythonIdentifiers(text) {
  const names = new Set()
  // 变量赋值：name = ...（name 为简单标识符）
  for (const m of text.matchAll(/(?:^|\n)([ \t]*)([A-Za-z_]\w*)\s*=/g)) {
    names.add(m[2])
  }
  // def / class 定义
  for (const m of text.matchAll(/(?:^|\n)(?:[ \t]*)(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)/g)) {
    names.add(m[1])
  }
  for (const m of text.matchAll(/(?:^|\n)(?:[ \t]*)class[ \t]+([A-Za-z_]\w*)/g)) {
    names.add(m[1])
  }
  // import module / import module as alias
  for (const m of text.matchAll(/\bimport[ \t]+([A-Za-z_]\w*)(?:[ \t]+as[ \t]+([A-Za-z_]\w*))?/g)) {
    names.add(m[2] || m[1])
  }
  // from module import a, b as c
  for (const m of text.matchAll(/\bfrom[ \t]+[A-Za-z_.]+\b[ \t]+import[ \t]+([^\n]+)/g)) {
    for (const part of m[1].split(',')) {
      const im = part.trim().match(/^([A-Za-z_]\w*)(?:[ \t]+as[ \t]+([A-Za-z_]\w*))?/)
      if (im) names.add(im[2] || im[1])
    }
  }
  // for 循环变量：for x in ...
  for (const m of text.matchAll(/\bfor[ \t]+([A-Za-z_]\w*)/g)) {
    names.add(m[1])
  }
  // with ... as x
  for (const m of text.matchAll(/\bas[ \t]+([A-Za-z_]\w*)/g)) {
    names.add(m[1])
  }
  return Array.from(names)
}

// 根据语言 + 前缀 + 当前文本上下文返回候选
export function getCompletionCandidates(lang, prefix, text, pos) {
  const langL = (lang || '').toLowerCase()

  if (langL === 'python' || langL === 'py') {
    const out = []
    // 检测 "moduleName." 形式 → 模块函数补全（前缀是函数名部分，可能为空）
    const dot = /([A-Za-z_]\w*)\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(text.slice(0, pos))
    if (dot) {
      const modName = dot[1]
      const fnPrefix = (dot[2] || '').toLowerCase()
      const funcs = pythonData.moduleFunctions[modName]
      if (funcs) {
        for (const fn of funcs) {
          if (!fnPrefix || fn.toLowerCase().startsWith(fnPrefix)) {
            out.push({ label: `${modName}.${fn}`, insert: fn, type: 'modfunc' })
          }
        }
        const seen = new Set()
        return out.filter(c => {
          if (seen.has(c.label)) return false
          seen.add(c.label)
          return true
        }).slice(0, 20)
      }
    }
    const p = prefix.toLowerCase()
    // 用户已定义的标识符（变量/函数/类名）优先——最常被引用
    const userIdentifiers = extractPythonIdentifiers(text.slice(0, pos))
    for (const id of userIdentifiers) {
      if (matches(p, id.toLowerCase())) {
        out.push({ label: id, insert: id, type: 'var' })
      }
    }
    // 关键字
    for (const k of pythonData.keywords) {
      if (matches(p, k.toLowerCase())) {
        out.push({ label: k, insert: k + ' ', type: 'keyword' })
      }
    }
    // 内置
    for (const b of pythonData.builtins) {
      if (matches(p, b.toLowerCase())) {
        out.push({ label: b, insert: b, type: 'builtin' })
      }
    }
    // 模块
    for (const m of pythonData.modules) {
      if (matches(p, m.toLowerCase())) {
        out.push({ label: m, insert: m, type: 'module' })
      }
    }
    // 去重（用户标识符若与关键字/内置同名，保留用户定义）
    const seen = new Set()
    const deduped = []
    for (const c of out) {
      const k = c.label
      if (seen.has(k)) continue
      seen.add(k)
      deduped.push(c)
    }
    return deduped.slice(0, 20)
  }

  if (langL === 'md' || langL === 'markdown' || langL === '') {
    return MD_SNIPPETS.filter(s => prefix.startsWith(s.keyword)).slice(0, 15)
  }

  return []
}

// 提取光标前的词前缀（标识符字符）
export function getPrefixBeforeCaret(text, pos) {
  const m = /([A-Za-z_][A-Za-z0-9_.]*)$/.exec(text.slice(0, pos))
  return m ? m[1] : ''
}

// 提取光标前的 md 语法前缀（允许 # - * ` > | 等标点）
export function getMdPrefixBeforeCaret(text, pos) {
  const m = /([#`>\-*+|[0-9].*)$/.exec(text.slice(0, pos))
  return m ? m[1] : ''
}