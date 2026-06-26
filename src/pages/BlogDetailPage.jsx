import { useState, useEffect } from 'react'
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

function BlogDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [blog, setBlog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [deleting, setDeleting] = useState(false)

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
    if (!window.confirm('确定删除这篇博客？')) return
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
                  <Link to="/#projects" onClick={() => setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100)}>项目</Link>
                  <Link to="/#contact" onClick={() => setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100)}>联系</Link>
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
        <div className="blog-detail">
          <div className="blog-detail-nav">
            <Link to="/blogs" className="blog-back-link">&larr; 返回列表</Link>
          </div>

          <h1 className="blog-detail-title">{blog.title}</h1>
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
              <button className="btn-delete" onClick={handleDelete} disabled={deleting}>
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
    </div>
  )
}

export default BlogDetailPage
