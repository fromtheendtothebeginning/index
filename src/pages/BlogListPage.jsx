import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import './Blog.css'

const API_BASE = '/api'
const CATEGORIES = ['技术讨论', '更新日志', '娱乐论坛']

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

  // 管理员操作
  const [withdrawTarget, setWithdrawTarget] = useState(null) // { id, title }

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

  const isAdmin = user && user.role === 'admin'

  const authHeaders = () => {
    const token = localStorage.getItem('token')
    return { Authorization: `Bearer ${token}` }
  }

  // 管理员撤回博客
  const handleWithdraw = async () => {
    if (!withdrawTarget) return
    try {
      const res = await fetch(`/api/admin/blogs/${withdrawTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.detail || '撤回失败')
        return
      }
      setBlogs(prev => prev.filter(b => b.id !== withdrawTarget.id))
      setTotal(t => Math.max(0, t - 1))
    } catch {
      alert('网络错误')
    } finally {
      setWithdrawTarget(null)
    }
  }

  // 管理员设置分类
  const handleSetCategory = async (blogId, newCat) => {
    try {
      const res = await fetch(`/api/admin/blogs/${blogId}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ category: newCat || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.detail || '分类修改失败')
        return
      }
      setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, category: newCat || null } : b))
    } catch {
      alert('网络错误')
    }
  }

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
                <div key={blog.id} className="blog-card scroll-reveal">
                  <Link to={`/blogs/${blog.id}`} className="blog-card-link">
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
                  {isAdmin && (
                    <div className="blog-card-admin" onClick={e => e.preventDefault()}>
                      <select
                        className="blog-card-category-select"
                        value={blog.category || ''}
                        onChange={(e) => handleSetCategory(blog.id, e.target.value)}
                        title="设置分类"
                      >
                        <option value="">未分类</option>
                        {CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      <button
                        className="blog-card-withdraw"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setWithdrawTarget({ id: blog.id, title: blog.title })
                        }}
                        title="撤回"
                      >
                        撤回
                      </button>
                    </div>
                  )}
                </div>
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

      <Modal
        open={!!withdrawTarget}
        title="管理员撤回博客"
        message={withdrawTarget ? `确认撤回《${withdrawTarget.title}》？撤回后博客将被删除，无法恢复。` : ''}
        confirmText="确认撤回"
        danger
        onConfirm={handleWithdraw}
        onCancel={() => setWithdrawTarget(null)}
      />
    </div>
  )
}

export default BlogListPage
