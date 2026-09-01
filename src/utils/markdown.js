// markdown.js — 轻量 Markdown 渲染器
// 支持大多数常用语法：标题、段落、强调、行内/代码块、链接、图片、
// 引用、有序/无序列表、表格、分隔线、删除线、LaTeX 数学公式（KaTeX）等。

import katex from 'katex'
import hljs from 'highlight.js/lib/common'
import { t } from '../i18n/index.js'

// 数学公式渲染：throwOnError:false 下 KaTeX 会自行转义错误输入，try/catch 仅作保险
function renderMath(latex, displayMode) {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'html', strict: false })
  } catch {
    return escapeHtml(latex)
  }
}

// 清理字符串中的占位符（用于 HTML 属性位置，防止 KaTeX HTML 注入属性破坏结构）
const stripPlaceholders = (s) => String(s).replace(/\u0000(?:MATHB?|CODE|CODEBLOCK|MEDIA)\d+\u0000/g, '')

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 代码块渲染：已知语言按语言高亮；未知语言/无语言走 highlightAuto 自动检测；异常则纯文本兜底。
// 代码内容一律经 hljs（内部已转义）或 escapeHtml，禁止裸插原文，保持 XSS 防线。
function renderCodeBlock(rawLang, code) {
  const lang = String(rawLang || '').trim().toLowerCase()
  let html
  let effective = lang
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } else {
      const r = hljs.highlightAuto(code)
      html = r.value
      effective = lang || r.language || ''
    }
  } catch {
    html = escapeHtml(code)
  }
  const attr = effective ? ` data-lang="${escapeHtml(effective)}"` : ''
  const label = t('md.copyCode')
  const icon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
  return `<div class="md-code-block"><button type="button" class="md-code-copy" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon}<span class="md-code-copy-label">${escapeHtml(label)}</span></button><pre class="lang-${escapeHtml(lang)}"${attr}><code class="hljs">${html}</code></pre></div>`
}

// 复制按钮事件委托：markdown-body 由 dangerouslySetInnerHTML 注入，需全局委托。
// 在 main.jsx 调用一次即可（幂等）。
let copyBound = false
export function initMarkdownCopy() {
  if (copyBound) return
  copyBound = true
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.md-code-copy')
    if (!btn) return
    const block = btn.closest('.md-code-block')
    if (!block) return
    const codeEl = block.querySelector('pre code')
    if (!codeEl) return
    const text = codeEl.textContent ?? ''
    const setState = (label, ok) => {
      const span = btn.querySelector('.md-code-copy-label')
      if (span) span.textContent = t(label)
      btn.classList.toggle('copied', ok)
    }
    const doCopy = () => {
      navigator.clipboard.writeText(text).then(() => {
        setState('md.copied', true)
        setTimeout(() => setState('md.copyCode', false), 1600)
      }).catch(() => setState('md.copyFailed', false))
    }
    if (navigator.clipboard?.writeText) {
      doCopy()
    } else {
      // 降级：兼容非 HTTPS/localhost 等无 Clipboard API 场景
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setState('md.copied', true)
        setTimeout(() => setState('md.copyCode', false), 1600)
      } catch {
        setState('md.copyFailed', false)
      }
      document.body.removeChild(ta)
    }
  })
}

// 反转 step1 的 & / < / > 转义（未闭合代码块兜底时 buf 内容已被转义，
// 需还原后再交给 hljs 重新转义一次，避免 &lt; 二次转义成 &amp;lt;）
const unescapeStep1 = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// 行内插值专用：仅转义引号，避免把 step1 已转义的 &lt; 等二次转义成 &amp;lt;
const escapeQ = (s) => String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// 链接/图片 URL 白名单：仅 http(s)/协议相对/mailto/锚点/站内路径，其余协议（javascript: data: 等）拒绝
export function sanitizeUrl(url) {
  const u = (url || '').trim()
  if (/^(https?:)?\/\//i.test(u)) return u
  if (/^mailto:/i.test(u)) return u
  if (/^#/.test(u) || /^\//.test(u)) return u
  return null
}

// —— 媒体嵌入白名单：支持 <video> <iframe> <embed> <audio>
// 属性白名单 + src 仅允许 http(s)，其余属性一律丢弃，防 XSS
const MEDIA_ATTRS = {
  video: ['src', 'controls', 'width', 'height', 'poster'],
  iframe: ['src', 'width', 'height', 'title', 'loading', 'allowfullscreen'],
  embed: ['src', 'type', 'width', 'height'],
  audio: ['src', 'controls'],
}
const MEDIA_RE = /<(video|iframe|embed|audio)\b[^>]*>[\s\S]*?<\/\1>|<(video|iframe|embed|audio)\b[^>]*\/?>/g

// iframe 域名白名单：仅允许视频/音乐平台，其余一律拒绝
const IFRAME_ALLOWED_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.bilibili.com',
  'www.bilibili.com',
  'player.youku.com',
  'open.spotify.com',
])

function sanitizeMedia(tag) {
  const m = tag.match(/^<(\w+)\b([^>]*)>/)
  if (!m) return null
  const name = m[1]
  const allowed = MEDIA_ATTRS[name]
  if (!allowed) return null
  const attrs = {}
  const re = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let a
  while ((a = re.exec(m[2]))) {
    attrs[a[1].toLowerCase()] = (a[2] ?? a[3] ?? a[4] ?? '')
  }
  if (name === 'iframe' && attrs.src) {
    let host = ''
    try { host = new URL(attrs.src.trim(), 'https://x').hostname } catch {}
    if (!IFRAME_ALLOWED_HOSTS.has(host)) return null
  }
  const out = []
  for (const k of allowed) {
    const v = attrs[k]
    if (v === undefined) continue
    if (k === 'src') {
      if (!/^(https?:)?\/\//i.test(v.trim())) continue
      out.push(` src="${escapeHtml(v.trim())}"`)
    } else if (k === 'controls' || k === 'allowfullscreen') {
      out.push(` ${k}`)
    } else {
      out.push(` ${k}="${escapeHtml(v)}"`)
    }
  }
  if (!out.some(s => s.includes(' src='))) return null
  const extra = name === 'iframe'
    ? ' sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms" referrerpolicy="no-referrer"'
    : ''
  return `<${name}${out.join('')}${extra}${/\/>$/.test(tag) ? ' />' : `></${name}>`}`
}

// 处理行内标记：粗体、斜体、删除线、链接、图片（行内代码已在 step0 预提取为占位符）
function renderInline(text) {
  let s = text

  // 图片 ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url, title) => {
      const cleanAlt = stripPlaceholders(alt)
      const u = sanitizeUrl(stripPlaceholders(url))
      if (!u) return `![${alt}](${url})`
      const t = title ? ` title="${escapeQ(stripPlaceholders(title))}"` : ''
      return `<img src="${escapeQ(u)}" alt="${escapeQ(cleanAlt)}"${t} loading="lazy" />`
    }
  )
  // 链接 [text](url)
  s = s.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, text, url, title) => {
      const u = sanitizeUrl(stripPlaceholders(url))
      if (!u) return text
      const t = title ? ` title="${escapeQ(stripPlaceholders(title))}"` : ''
      // 显示文本保留占位符：公式在链接内渲染是期望行为
      return `<a href="${escapeQ(u)}" target="_blank" rel="noopener noreferrer"${t}>${escapeQ(text)}</a>`
    }
  )

  // 粗体 **text** 或 __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  // 斜体 *text* 或 _text_
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, '$1<em>$2</em>')
  // 删除线 ~~text~~
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return s
}

// 渲染表格：识别 header 行 + 分隔行 + 数据行
function renderTable(lines) {
  if (lines.length < 2) return null
  const headerCells = lines[0].split('|').map(c => c.trim()).filter((_, i, arr) => {
    // 去除首尾空 cell（由 | 起止产生）
    return !(i === 0 && arr[0] === '') && !(i === arr.length - 1 && arr[arr.length - 1] === '')
  })
  const sepCells = lines[1].split('|').map(c => c.trim())
  const isSep = sepCells.some(c => /^\:?-+\:?$/.test(c))
  if (!isSep) return null

  // 对齐方式
  const aligns = sepCells.filter(c => c !== '').map(c => {
    if (c.startsWith(':') && c.endsWith(':')) return 'center'
    if (c.endsWith(':')) return 'right'
    return 'left'
  })

  const rowsHtml = lines.slice(2).map(line => {
    const cells = line.split('|').map(c => c.trim())
      .filter((_, i, arr) => !(i === 0 && arr[0] === '') && !(i === arr.length - 1 && arr[arr.length - 1] === ''))
    const tds = cells.map((c, i) =>
      `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${renderInline(c)}</td>`
    ).join('')
    return `<tr>${tds}</tr>`
  }).join('')

  const ths = headerCells.map((c, i) =>
    `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${renderInline(c)}</th>`
  ).join('')

  // 外层包横向滚动容器（窄屏表格可滚动，保持表格布局不被破坏）
  return `<div class="markdown-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`
}

export function renderMd(text) {
  if (!text) return ''

  // 0. 预提取：先保护代码块，再提取行内代码与公式（避免 $ 在代码内被当公式），最后提取媒体嵌入
  const mediaBlocks = []
  const codeBlocks = []
  const codeStash = []
  const mathStash = []
  text = text.replace(/```[\s\S]*?```/g, (m) => {
    const lang = m.match(/^```(\w*)/)?.[1] || ''
    const body = m.replace(/^```\w*\s*\n?/, '').replace(/\n?```$/, '')
    codeBlocks.push(renderCodeBlock(lang, body))
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`
  })
  // 行内代码提前提取，保证 `$x$` 等公式语法在反引号内不被当作公式
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeStash.push(escapeHtml(code))
    return `\u0000CODE${codeStash.length - 1}\u0000`
  })
  // 块级公式 $$...$$ 与 \[...\]（必须先于行内公式提取）
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    mathStash.push({ latex, display: true })
    return `\u0000MATHB${mathStash.length - 1}\u0000`
  })
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, latex) => {
    mathStash.push({ latex, display: true })
    return `\u0000MATHB${mathStash.length - 1}\u0000`
  })
  // 行内公式 $...$ 与 \(...\)（负向后行断言防 \$，开闭两侧禁空白，内容禁换行与 $；
  // 闭合 $ 后允许空白——兼容 `$x$ 文本` 写法，仅禁止内容以空格结尾）
  text = text.replace(/(?<!\\)\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\$)/g, (_, latex) => {
    mathStash.push({ latex, display: false })
    return `\u0000MATH${mathStash.length - 1}\u0000`
  })
  text = text.replace(/\\\(([^\n]+?)\\\)/g, (_, latex) => {
    mathStash.push({ latex, display: false })
    return `\u0000MATH${mathStash.length - 1}\u0000`
  })
  // 未被公式消费的 \$ 还原为字面 $
  text = text.replace(/\\\$/g, '$')
  text = text.replace(MEDIA_RE, (m) => {
    const safe = sanitizeMedia(m)
    if (!safe) return m
    mediaBlocks.push(safe)
    return `\u0000MEDIA${mediaBlocks.length - 1}\u0000`
  })

  // 反斜杠转义（CommonMark §2.4）：\ + ASCII 标点 → 该标点字面量；
  // 代码块/行内代码/公式/媒体已提取为占位符，天然不受影响
  const escStash = []
  text = text.replace(/(\\([!"#$%&'()*+,.\/:;<=>?@[\\\]^_`{|}~-]))/g, (m, _, ch) => {
    escStash.push(ch)
    return `\u0000ESC${escStash.length - 1}\u0000`
  })

  // HTML 实体（CommonMark §2.5）：命名/十进制/十六进制字符引用 → 字符字面量；
  // 未知实体名与非法码点保留原文（step1 会把 & 转义为 &amp;，不会泄漏可执行 HTML）
  const ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:'\'', nbsp:'\u00a0', copy:'\u00a9', reg:'\u00ae', trade:'\u2122', hellip:'\u2026', mdash:'\u2014', ndash:'\u2013', times:'\u00d7', divide:'\u00f7', plusmn:'\u00b1', middot:'\u00b7', bull:'\u2022', deg:'\u00b0', sect:'\u00a7', para:'\u00b6', dagger:'\u2020', Dagger:'\u2021', permil:'\u2030', laquo:'\u00ab', raquo:'\u00bb', lsaquo:'\u2039', rsaquo:'\u203a', euro:'\u20ac', pound:'\u00a3', yen:'\u00a5', cent:'\u00a2', curren:'\u00a4', micro:'\u00b5', not:'\u00ac', prime:'\u2032', Prime:'\u2033', larr:'\u2190', rarr:'\u2192', uarr:'\u2191', darr:'\u2193', harr:'\u2194', lArr:'\u21d0', rArr:'\u21d2', infin:'\u221e', ne:'\u2260', le:'\u2264', ge:'\u2265', sum:'\u2211', prod:'\u220f', radic:'\u221a', int:'\u222b', frac12:'\u00bd', frac14:'\u00bc', frac34:'\u00be', alpha:'\u03b1', beta:'\u03b2' }
  const entStash = []
  text = text.replace(/&([a-zA-Z][a-zA-Z0-9]{1,31}|#x[0-9a-fA-F]{1,6}|#\d{1,7});/g, (m, name) => {
    let cp = null
    if (name[0] === '#') {
      const hex = /^#x[0-9a-fA-F]+$/.test(name)
      const digits = hex ? name.slice(2) : name.slice(1)
      cp = parseInt(digits, hex ? 16 : 10)
      if (!Number.isFinite(cp) || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = null
    } else {
      const ch = ENTITIES[name]
      if (ch !== undefined) cp = ch.codePointAt(0)
    }
    if (cp === null) return m
    entStash.push(String.fromCodePoint(cp))
    return `\u0000ENT${entStash.length - 1}\u0000`
  })

  // 自动链接（CommonMark §6.5）：<https://...> / <mailto:...> / 裸邮箱 → <a>
  const autoStash = []
  text = text.replace(/<([^<>\s]+)>/g, (m, content) => {
    let url = null
    if (/^(https?:)?\/\//i.test(content) || /^mailto:/i.test(content)) {
      url = sanitizeUrl(content)
    } else if (/^[\w.+-]+@[\w-]+\.[\w-]+$/.test(content)) {
      url = 'mailto:' + content
    }
    if (!url) return m
    autoStash.push({ href: url, text: content })
    return `\u0000AUTO${autoStash.length - 1}\u0000`
  })

  // 1. 转义 HTML
  let src = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // 2. 统一换行符
  src = src.replace(/\r\n?/g, '\n')

  // 3. 按行切分处理块级元素
  const lines = src.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // —— 代码块占位行（入口已预提取闭合代码块）
    const cbMatch = line.match(/^\u0000CODEBLOCK(\d+)\u0000$/)
    if (cbMatch) {
      out.push(codeBlocks[Number(cbMatch[1])])
      i++
      continue
    }

    // —— 未闭合代码块兜底
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      const lang = fence[1] || ''
      const buf = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束 ```
      const codeHtml = renderCodeBlock(lang, unescapeStep1(buf.join('\n')))
      codeBlocks.push(codeHtml)
      out.push(`\u0000BLOCK${codeBlocks.length - 1}\u0000`)
      continue
    }

    // —— 媒体占位行（独立一行的视频嵌入）
    const mediaMatch = line.match(/^\u0000MEDIA(\d+)\u0000$/)
    if (mediaMatch) {
      out.push(mediaBlocks[Number(mediaMatch[1])])
      i++
      continue
    }

    // —— 缩进代码块（CommonMark §4.4）：行首 4 空格，仅当处于块边界（段落延续由段落分支并入）
    if (/^ {4}/.test(line) && line.trim() !== '') {
      const buf = [line.replace(/^ {4}/, '')]
      i++
      while (i < lines.length && (/^ {4}/.test(lines[i]) || lines[i].trim() === '')) {
        buf.push(/^ {4}/.test(lines[i]) ? lines[i].replace(/^ {4}/, '') : '')
        i++
      }
      while (buf.length && buf[buf.length - 1] === '') buf.pop()
      out.push(renderCodeBlock('', unescapeStep1(buf.join('\n'))))
      continue
    }

    // —— 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push('<hr />')
      i++
      continue
    }

    // —— 标题（# ~ ######）
    const header = line.match(/^(#{1,6})\s+(.*)$/)
    if (header) {
      const level = header[1].length
      out.push(`<h${level}>${renderInline(header[2].trim())}</h${level}>`)
      i++
      continue
    }

    // —— 引用 > ...（step1 已把 > 转义为 &gt;，此处按转义形态识别并还原后递归）
    if (/^\s*&gt;\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ''))
        i++
      }
      out.push(`<blockquote>${renderMd(unescapeStep1(buf.join('\n')))}</blockquote>`)
      continue
    }

    // —— 表格（连续的 | 分隔行，且第二行是分隔）
    if (/\|/.test(line) && i + 1 < lines.length && /\|/.test(lines[i]) && /^\s*\|?.*[-:]+\|[-:\s|]+$/.test(lines[i + 1])) {
      const buf = [line]
      i++
      buf.push(lines[i])
      i++
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        buf.push(lines[i])
        i++
      }
      const tableHtml = renderTable(buf)
      if (tableHtml) {
        out.push(tableHtml)
        continue
      }
      // 不是表格则回退为普通行
      buf.forEach(b => out.push(`<p>${renderInline(b)}</p>`))
      continue
    }

    // —— 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)
        const indent = m[1].length
        const content = m[2]
        buf.push({ indent, content })
        i++
      }
      // 简单处理嵌套：按 indent 分层
      const buildList = (items, start, baseIndent) => {
        const lis = []
        let j = start
        while (j < items.length && items[j].indent >= baseIndent) {
          if (items[j].indent === baseIndent) {
            let content
            const task = items[j].content.match(/^\[([ xX])\]\s+(.*)$/)
            if (task) {
              const checked = task[1] !== ' '
              content = `<input type="checkbox" disabled${checked ? ' checked' : ''}> ${renderInline(task[2])}`
            } else {
              content = renderInline(items[j].content)
            }
            // 子项
            if (j + 1 < items.length && items[j + 1].indent > baseIndent) {
              const sub = buildList(items, j + 1, items[j + 1].indent)
              content += sub.html
              j = sub.end
            }
            lis.push(`<li${task ? ' class="task-list-item"' : ''}>${content}</li>`)
            j++
          } else {
            // 跳过异常缩进
            j++
          }
        }
        return { html: `<ul>${lis.join('')}</ul>`, end: j }
      }
      if (buf.length > 0) {
        const result = buildList(buf, 0, buf[0].indent)
        out.push(result.html)
      }
      continue
    }

    // —— 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)(\d+)\.\s+(.*)$/)
        buf.push({ indent: m[1].length, content: m[3] })
        i++
      }
      const buildList = (items, start, baseIndent) => {
        const lis = []
        let j = start
        while (j < items.length && items[j].indent >= baseIndent) {
          if (items[j].indent === baseIndent) {
            let content = renderInline(items[j].content)
            if (j + 1 < items.length && items[j + 1].indent > baseIndent) {
              const sub = buildList(items, j + 1, items[j + 1].indent)
              content += sub.html
              j = sub.end
            }
            lis.push(`<li>${content}</li>`)
            j++
          } else {
            j++
          }
        }
        return { html: `<ol>${lis.join('')}</ol>`, end: j }
      }
      if (buf.length > 0) {
        const result = buildList(buf, 0, buf[0].indent)
        out.push(result.html)
      }
      continue
    }

    // —— 空行
    if (line.trim() === '') {
      i++
      continue
    }

    // —— 普通段落（合并连续的非空非块行）
    const buf = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*&gt;\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]) &&
      !/^\s*[=-]+\s*$/.test(lines[i]) &&
      !(/\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?.*[-:]+\|[-:\s|]+$/.test(lines[i + 1]))
    ) {
      buf.push(lines[i])
      i++
    }
    // 硬换行（CommonMark §6.7）：非末行行尾两个以上空格或单个 \（且非转义字面 \）→ <br />
    for (let k = 0; k < buf.length - 1; k++) {
      buf[k] = buf[k].replace(/ {2,}$/, '\u0000BR\u0000').replace(/(^|[^\\])\\(?!\\+$)$/, '$1\u0000BR\u0000')
    }
    // Setext 标题（CommonMark §4.3）：下一行为纯 =+ 或 -+ 下划线时吞掉并输出对应标题
    if (i < lines.length && /^\s*[=-]+\s*$/.test(lines[i]) && lines[i].trim() !== '') {
      const level = lines[i].trim()[0] === '=' ? 1 : 2
      i++
      out.push(`<h${level}>${renderInline(buf.join(' ').replace(/\u0000BR\u0000/g, ' '))}</h${level}>`)
      continue
    }
    out.push(`<p>${renderInline(buf.join(' '))}</p>`)
  }

  // 4. 拼接
  let html = out.join('\n')

  // 5. 还原代码块占位（入口预提取 + 未闭合兜底）
  //    越界时原样保留占位符：引用块递归 renderMd 会带入外部占位符，
  //    由外层作用域最终还原，避免丢失内容或渲染出 "undefined"
  html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, idx) => codeBlocks[Number(idx)] ?? `\u0000CODEBLOCK${idx}\u0000`)
  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, idx) => codeBlocks[Number(idx)] ?? `\u0000BLOCK${idx}\u0000`)

  // 6. 还原媒体嵌入占位
  html = html.replace(/\u0000MEDIA(\d+)\u0000/g, (_, idx) => mediaBlocks[Number(idx)] ?? `\u0000MEDIA${idx}\u0000`)

  // 7. 还原自动链接占位（<a> 通过 escapeHtml 构造，URL 经 sanitizeUrl 白名单校验，防 XSS）
  html = html.replace(/\u0000AUTO(\d+)\u0000/g, (_, idx) => {
    const a = autoStash[Number(idx)]
    return a ? `<a href="${escapeHtml(a.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.text)}</a>` : `\u0000AUTO${idx}\u0000`
  })

  // 8. 还原 HTML 实体占位（内容为合法 Unicode 字符，非 HTML 标签源码）
  html = html.replace(/\u0000ENT(\d+)\u0000/g, (_, idx) => {
    const e = entStash[Number(idx)]
    return e === undefined ? `\u0000ENT${idx}\u0000` : escapeHtml(e)
  })

  // 9. 还原反斜杠转义占位（内容为该标点字面量）
  html = html.replace(/\u0000ESC(\d+)\u0000/g, (_, idx) => {
    const c = escStash[Number(idx)]
    return c === undefined ? `\u0000ESC${idx}\u0000` : escapeHtml(c)
  })

  // 10. 还原硬换行占位
  html = html.replace(/\u0000BR\u0000/g, '<br />')

  // 11. 还原行内代码与数学公式占位（KaTeX 输出直接作为 HTML 注入，属预期行为）
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => {
    const c = codeStash[Number(idx)]
    return c === undefined ? `\u0000CODE${idx}\u0000` : `<code>${c}</code>`
  })
  html = html.replace(/\u0000MATHB(\d+)\u0000/g, (_, idx) => {
    const m = mathStash[Number(idx)]
    return m ? renderMath(m.latex, true) : `\u0000MATHB${idx}\u0000`
  })
  html = html.replace(/\u0000MATH(\d+)\u0000/g, (_, idx) => {
    const m = mathStash[Number(idx)]
    return m ? renderMath(m.latex, false) : `\u0000MATH${idx}\u0000`
  })

  return html
}
