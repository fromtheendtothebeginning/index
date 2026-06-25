import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Blog.css'

const API_BASE = '/api'

function BlogListPage() {
  const [blogs, setBlogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const limit = 12
  const [user, setUser] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetch(`${API_BASE}/blogs?skip=${page * limit}&limit=${limit}`)
      .then(r => r.json())
      .then(data => {
        setBlogs(data.blogs || [])
        setTotal(data.total || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    const els = document.querySelectorAll('.scroll-reveal')
    if (!els.length) return
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            obs.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 }
    )
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [blogs])

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    navigate('/')
  }

  const totalPages = Math.ceil(total / limit)

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
                <button className="nav-logout-btn" onClick={handleLogout}>退出</button>
              </div>
            ) : (
              <Link to="/login" className="nav-login-btn">登录</Link>
            )}
          </div>
        </div>
      </nav>

      <div className="blog-main">
        <div className="blog-header scroll-reveal">
          <div className="blog-header-content">
            <div className="blog-breadcrumb">
              <Link to="/" className="blog-home-link">← 回到首页</Link>
            </div>
            <h1 className="blog-title">博客</h1>
            <p className="blog-subtitle">记录思考，分享创造</p>
          </div>
          {user && (
            <Link to="/blogs/new" className="btn btn-primary blog-write-btn">
              写文章
            </Link>
          )}
        </div>

        {loading ? (
          <div className="blog-loading">加载中...</div>
        ) : blogs.length === 0 ? (
          <div className="blog-empty">
            <p>还没有文章</p>
            {user && <Link to="/blogs/new" className="btn btn-primary">写第一篇</Link>}
          </div>
        ) : (
          <>
            <div className="blog-grid">
              {blogs.map(blog => (
                <Link to={`/blogs/${blog.id}`} key={blog.id} className="blog-card scroll-reveal">
                  <div className="blog-card-body">
                    <h2 className="blog-card-title">{blog.title}</h2>
                    <div className="blog-card-meta">
                      <span className="blog-card-author">
                        {blog.author?.nickname || blog.author?.username || '匿名'}
                      </span>
                      <span className="blog-card-date">
                        {new Date(blog.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="blog-pagination">
                <button
                  className="pagination-btn"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  上一页
                </button>
                <span className="pagination-info">{page + 1} / {totalPages}</span>
                <button
                  className="pagination-btn"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default BlogListPage
