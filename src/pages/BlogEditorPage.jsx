import { useState, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { renderMd } from '../utils/markdown'
import './Blog.css'

function BlogEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const textareaRef = useRef(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
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
        setCategory(data.category || '')
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
        body: JSON.stringify({ title: title.trim(), category: category || '', content_md: content }),
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
      <Navbar activePage="blog" />

      <div className="blog-main">
          <div className="blog-editor">
            <div className="editor-header">
              <Link to="/blogs" className="blog-back-link">&larr; 返回列表</Link>
            </div>
            <h1 className="editor-title">{isEdit ? '编辑文章' : '写文章'}</h1>

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
            <div className="nav-dropdown">
              <button className="category-btn">{category || '无'} <span className="arrow-down">▾</span></button>
              <div className="nav-dropdown-menu">
                <a href="#" onClick={e => { e.preventDefault(); setCategory(''); }}>无</a>
                <a href="#" onClick={e => { e.preventDefault(); setCategory('技术讨论'); }}>技术讨论</a>
                <a href="#" onClick={e => { e.preventDefault(); setCategory('更新日志'); }}>更新日志</a>
                <a href="#" onClick={e => { e.preventDefault(); setCategory('娱乐论坛'); }}>娱乐论坛</a>
              </div>
            </div>
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
