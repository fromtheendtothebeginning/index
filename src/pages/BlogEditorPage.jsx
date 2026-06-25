import { useState, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import './Blog.css'

function renderMd(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
  html = html.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  html = html.replace(/\n\n/g, '</p><p>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<\/?p>(<ul>|<\/ul>|<pre>|<\/pre>|<h[1-3]>|<\/h[1-3]>)/g, '$1')
  html = html.replace(/(<ul>|<\/ul>|<pre>|<\/pre>|<h[1-3]>|<\/h[1-3]>)<\/?p>/g, '$1')
  return html
}

function BlogEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const textareaRef = useRef(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) navigate('/login')
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [navigate])

  useEffect(() => {
    if (!isEdit) return
    fetch(`/api/blogs/${id}`)
      .then(r => r.json())
      .then(data => {
        setTitle(data.title)
        setContent(data.content_md)
      })
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const handleInsertImage = () => {
    const url = prompt('输入图片 URL（支持图床链接）：')
    if (!url) return
    const ta = textareaRef.current
    if (!ta) {
      setContent(c => c + `\n![图片](${url})\n`)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const imgTag = `\n![图片](${url})\n`
    const newContent = content.slice(0, start) + imgTag + content.slice(end)
    setContent(newContent)
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + imgTag.length
    }, 0)
  }

  const handleSave = async () => {
    if (!title.trim()) { setError('请输入标题'); return }
    if (!content.trim()) { setError('请输入内容'); return }
    const token = localStorage.getItem('token')
    setSaving(true)
    setError('')

    try {
      const url = isEdit ? `/api/blogs/${id}` : '/api/blogs'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: title.trim(), content_md: content }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || '保存失败'); return }
      navigate(isEdit ? `/blogs/${id}` : `/blogs/${data.id}`)
    } catch {
      setError('网络错误')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="blog-page">
        <div className="blog-main"><div className="blog-loading">加载中...</div></div>
      </div>
    )
  }

  return (
    <div className="blog-page">
      <nav className="navbar">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/favicon.svg" alt="anticraft" className="logo-icon" />
            <span className="logo-text">anticraft</span>
          </Link>
          <div className="nav-right">
            <div className="nav-links">
              <Link to="/blogs" className="nav-item-active">博客</Link>
              <div className="nav-dropdown">
                <Link to="/" className="nav-dropdown-trigger">首页<span className="arrow-down">▾</span></Link>
                <div className="nav-dropdown-menu">
                  <Link to="/" onClick={() => setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50)}>开始</Link>
                  <a href="/#projects">项目</a>
                  <a href="/#contact">联系</a>
                </div>
              </div>
            </div>
            {user ? (
              <div className="nav-user">
                <Link to="/profile" className="nav-user-avatar" title="编辑资料">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="nav-avatar-img" />
                  ) : (
                    <span className="nav-avatar-letter">
                      {(user.nickname || user.username).charAt(0).toUpperCase()}
                    </span>
                  )}
                </Link>
                <button className="nav-logout-btn" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); navigate('/'); }}>退出</button>
              </div>
            ) : (
              <Link to="/login" className="nav-login-btn">登录</Link>
            )}
          </div>
        </div>
      </nav>

      <div className="blog-main">
        <div className="blog-editor">
          <div className="editor-header">
            <Link to="/" className="blog-back-link">← 回到首页</Link>
            <Link to="/blogs" className="blog-back-link">&larr; 返回列表</Link>
            <h1 className="editor-title">{isEdit ? '编辑文章' : '写文章'}</h1>
          </div>

          {error && <div className="form-server-error">{error}</div>}

          <div className="editor-field">
            <input
              type="text"
              className="editor-title-input"
              placeholder="输入文章标题..."
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div className="editor-toolbar">
            <button type="button" className="toolbar-btn" onClick={handleInsertImage} title="插入图片">
              🖼 图床
            </button>
            <span className="toolbar-hint">支持 Markdown 语法，图片使用图床链接</span>
          </div>

          <div className="editor-split">
            <div className="editor-pane">
              <textarea
                ref={textareaRef}
                className="editor-textarea"
                placeholder="使用 Markdown 语法写文章..."
                value={content}
                onChange={e => setContent(e.target.value)}
              />
            </div>
            <div className="editor-pane preview-pane">
              <div className="preview-label">预览</div>
              <div
                className="markdown-body preview-content"
                dangerouslySetInnerHTML={{ __html: renderMd(content) || '<p style="color:var(--text-muted)">预览区域</p>' }}
              />
            </div>
          </div>

          <div className="editor-actions">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : (isEdit ? '保存修改' : '发布文章')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BlogEditorPage
