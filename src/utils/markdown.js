// markdown.js — 轻量 Markdown 渲染器
// 支持大多数常用语法：标题、段落、强调、行内/代码块、链接、图片、
// 引用、有序/无序列表、表格、分隔线、删除线等。

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 处理行内标记：粗体、斜体、删除线、行内代码、链接、图片
function renderInline(text) {
  let s = text
  // 行内代码（优先处理，避免内部被其他规则改写）
  const codeStash = []
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    codeStash.push(code)
    return `\u0000CODE${codeStash.length - 1}\u0000`
  })

  // 图片 ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url, title) => {
      const t = title ? ` title="${title}"` : ''
      return `<img src="${url}" alt="${alt}"${t} loading="lazy" />`
    }
  )
  // 链接 [text](url)
  s = s.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, text, url, title) => {
      const t = title ? ` title="${title}"` : ''
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"${t}>${text}</a>`
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

  // 还原行内代码
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codeStash[Number(i)])}</code>`)
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

  return `<table><thead><tr>${ths}</tr></thead><tbody>${rowsHtml}</tbody></table>`
}

export function renderMd(text) {
  if (!text) return ''

  // 1. 转义 HTML
  let src = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // 2. 统一换行符
  src = src.replace(/\r\n?/g, '\n')

  // 3. 按行切分处理块级元素
  const lines = src.split('\n')
  const out = []
  let i = 0

  // 代码块占位（避免被其他规则改写）
  const codeBlocks = []

  while (i < lines.length) {
    const line = lines[i]

    // —— 代码块 ```lang ... ```
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
      const codeHtml = `<pre><code class="lang-${lang}">${buf.join('\n')}</code></pre>`
      codeBlocks.push(codeHtml)
      out.push(`\u0000BLOCK${codeBlocks.length - 1}\u0000`)
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

    // —— 引用 > ...
    if (/^\s*>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${renderMd(buf.join('\n'))}</blockquote>`)
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
            let content = renderInline(items[j].content)
            // 子项
            if (j + 1 < items.length && items[j + 1].indent > baseIndent) {
              const sub = buildList(items, j + 1, items[j + 1].indent)
              content += sub.html
              j = sub.end
            }
            lis.push(`<li>${content}</li>`)
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
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]) &&
      !(/\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?.*[-:]+\|[-:\s|]+$/.test(lines[i + 1]))
    ) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${renderInline(buf.join(' '))}</p>`)
  }

  // 4. 拼接
  let html = out.join('\n')

  // 5. 还原代码块占位
  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, idx) => codeBlocks[Number(idx)])

  return html
}
