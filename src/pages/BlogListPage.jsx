import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import './Blog.css'

const API_BASE = '/api'

function BlogListPage() {
  const [blogs, setBlogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [searchParams] = useSearchParams()
  const [filterCategory, setFilterCategory] = useState(searchParams.get('category') || '')
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
    const cat = filterCategory ? `&category=${encodeURIComponent(filterCategory)}` : ''
    fetch(`${API_BASE}/blogs?skip=${page * limit}&limit=${limit}${cat}`)
      .then(r => r.json())
      .then(data => {
        setBlogs(data.blogs || [])
        setTotal(data.total || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, filterCategory])

  // 从 URL searchParams 同步分类（导航栏下拉点击时触发）
  useEffect(() => {
    const cat = searchParams.get('category') || ''
    setFilterCategory(cat)
    setPage(0)
  }, [searchParams])

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

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="blog-page">
      <Navbar activePage="blog" />

      <div className="blog-main">
        <div className="blog-header scroll-reveal">
          <div className="blog-header-content">
            <h1 className="blog-title">博客</h1>
            <p className="blog-subtitle">记录思考，分享创造</p>
          </div>
          {user && (
            <Link to="/blogs/new" className="btn btn-primary blog-write-btn">
              写文章
            </Link>
          )}
        </div>

        <div className="blog-filters">
          {['', '技术讨论', '更新日志', '娱乐论坛'].map(cat => (
            <button
              key={cat || 'all'}
              className={`blog-filter-btn ${filterCategory === cat ? 'active' : ''}`}
              onClick={() => { setFilterCategory(cat); setPage(0) }}
            >
              {cat || '全部'}
            </button>
          ))}
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
                    <h2 className="blog-card-title">
                      {blog.category && <span className="blog-card-category">{blog.category}</span>}
                      {blog.title}
                    </h2>
                    <div className="blog-card-meta">
                      <span className="blog-card-author">
                        {blog.author?.nickname || blog.author?.username || '匿名'}
                      </span>
                      <span className="blog-card-date">
                        {new Date(blog.created_at).toLocaleDateString('zh-CN')}
                      </span>
                      <span className="blog-card-stats">
                        <span className="blog-card-stat" title="点赞数">♥ {blog.like_count || 0}</span>
                        <span className="blog-card-stat" title="评论数">💬 {blog.comment_count || 0}</span>
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
