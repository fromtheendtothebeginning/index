import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
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

function BlogDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [blog, setBlog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/blogs/${id}`)
      .then(r => {
        if (!r.ok) throw new Error('博客不存在')
        return r.json()
      })
      .then(data => setBlog(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    const token = localStorage.getItem('token')
    setDeleting(true)
    try {
      const res = await fetch(`/api/blogs/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.detail || '删除失败')
        return
      }
      navigate('/blogs')
    } catch {
      alert('网络错误')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="blog-page">
        <div className="blog-main"><div className="blog-loading">加载中...</div></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="blog-page">
        <div className="blog-main">
          <div className="blog-error">
            <h2>{error}</h2>
            <Link to="/blogs" className="btn btn-primary">&larr; 返回博客列表</Link>
          </div>
        </div>
      </div>
    )
  }

  const isAuthor = user && blog && user.id === blog.author_id

  return (
    <div className="blog-page">
      <Navbar activePage="blog" />

      <div className="blog-main">
        <div className="blog-detail">
          <div className="blog-detail-nav">
            <Link to="/blogs" className="blog-back-link">&larr; 返回列表</Link>
          </div>

          <h1 className="blog-detail-title">
            {blog.category && <span className="blog-card-category">{blog.category}</span>}
            {blog.title}
          </h1>
          <div className="blog-detail-meta">
            <span className="blog-detail-author">
              作者：{blog.author?.nickname || blog.author?.username || '匿名'}
            </span>
            <span className="blog-detail-date">
              {new Date(blog.created_at).toLocaleDateString('zh-CN', {
                year: 'numeric', month: 'long', day: 'numeric'
              })}
            </span>
          </div>

          {isAuthor && (
            <div className="blog-detail-actions">
              <Link to={`/blogs/${blog.id}/edit`} className="btn-edit">编辑</Link>
              <button className="btn-delete" onClick={() => setShowDeleteModal(true)} disabled={deleting}>
                {deleting ? '删除中...' : '删除'}
              </button>
            </div>
          )}

          <div
            className="blog-content markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMd(blog.content_md) }}
          />
        </div>
      </div>

      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>这篇博客将被永久删除，无法恢复。确定继续吗？</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>取消</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BlogDetailPage
