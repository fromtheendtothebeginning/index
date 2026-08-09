import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import Reveal from '../components/Reveal'
import CategoryDropdown from '../components/CategoryDropdown'
import './Blog.css'

const API_BASE = '/api'
const CATEGORIES = ['技术讨论', '更新日志', '娱乐论坛']

const readSavedState = () => {
  try {
    const raw = sessionStorage.getItem('blog_list_state')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function BlogListPage() {
  const saved = readSavedState()
  const [blogs, setBlogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(saved?.page ?? 0)
  const [searchParams] = useSearchParams()
  const [filterCategory, setFilterCategory] = useState(searchParams.get('category') || saved?.category || '')
  const limit = 12
  const [user, setUser] = useState(null)
  const navigate = useNavigate()

  // 搜索 / 时间 / 排序 / 视图
  const [q, setQ] = useState(saved?.q || '')
  const [debouncedQ, setDebouncedQ] = useState(() => saved?.q || '')
  const [timeRange, setTimeRange] = useState(saved?.timeRange || '')
  const [sort, setSort] = useState(saved?.sort || 'comprehensive')
  const [view, setView] = useState(() => localStorage.getItem('blog_view') || 'grid')

  // 管理员操作
  const [withdrawTarget, setWithdrawTarget] = useState(null) // { id, title }

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [])

  // 搜索防抖 400ms，防抖结束后重置到第一页并触发请求
  const prevQ = useRef(q)
  useEffect(() => {
    if (q === prevQ.current) return
    prevQ.current = q
    const t = setTimeout(() => {
      setDebouncedQ(q)
      setPage(0)
    }, 400)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    setLoading(true)
    const from =
      timeRange === '7d' ? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
      : timeRange === '30d' ? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
      : timeRange === 'year' ? `${new Date().getFullYear()}-01-01`
      : ''
    const qs = [
      `skip=${page * limit}`,
      `limit=${limit}`,
      filterCategory ? `category=${encodeURIComponent(filterCategory)}` : '',
      debouncedQ ? `q=${encodeURIComponent(debouncedQ)}` : '',
      `sort=${sort}`,
      from ? `from=${from}` : '',
    ].filter(Boolean).join('&')
    fetch(`${API_BASE}/blogs?${qs}`)
      .then(r => r.json())
      .then(data => {
        setBlogs(data.blogs || [])
        setTotal(data.total || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, filterCategory, debouncedQ, sort, timeRange])

  // 从 URL searchParams 同步分类（导航栏下拉点击时触发）
  const prevURLCategory = useRef(searchParams.get('category') || '')
  useEffect(() => {
    const cat = searchParams.get('category') || ''
    if (cat === prevURLCategory.current) return
    prevURLCategory.current = cat
    setFilterCategory(cat)
    setPage(0)
  }, [searchParams])

  const latestState = useRef({})
  latestState.current = { sort, q, timeRange, page, category: filterCategory, scrollY: window.scrollY }

  useEffect(() => {
    return () => {
      sessionStorage.setItem('blog_list_state', JSON.stringify(latestState.current))
    }
  }, [])

  const pendingScroll = useRef(saved?.scrollY)
  useEffect(() => {
    if (loading || blogs.length === 0) return
    if (pendingScroll.current == null) return
    window.scrollTo(0, pendingScroll.current)
    pendingScroll.current = null
    const st = readSavedState()
    if (st) {
      const { scrollY, ...rest } = st
      sessionStorage.setItem('blog_list_state', JSON.stringify(rest))
    }
  }, [blogs, loading])

  const isAdmin = user && user.role === 'admin'

  const authHeaders = () => {
    const token = localStorage.getItem('token')
    return { Authorization: `Bearer ${token}` }
  }

  const switchView = (v) => {
    setView(v)
    localStorage.setItem('blog_view', v)
  }

  // 管理员切换精选（乐观更新）
  const handleToggleFeatured = async (blogId) => {
    const blog = blogs.find(b => b.id === blogId)
    if (!blog) return
    const next = !blog.is_featured
    setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, is_featured: next } : b))
    try {
      const res = await fetch(`/api/admin/blogs/${blogId}/featured`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ is_featured: next }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.detail || '精选设置失败')
        setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, is_featured: !next } : b))
      }
    } catch {
      alert('网络错误')
      setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, is_featured: !next } : b))
    }
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
        <Reveal className="blog-header">
          <div className="blog-header-content">
            <h1 className="blog-title">博客</h1>
            <p className="blog-subtitle">记录思考，分享创造</p>
          </div>
          {user && (
            <Link to="/blogs/new" className="btn btn-primary blog-write-btn">
              写文章
            </Link>
          )}
        </Reveal>

        <div className="blog-toolbar">
          <input
            className="blog-search-input"
            placeholder="搜索博客标题或内容…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <CategoryDropdown
            value={timeRange}
            onChange={(v) => { setTimeRange(v); setPage(0) }}
            options={[
              { value: '7d', label: '近7天' },
              { value: '30d', label: '近30天' },
              { value: 'year', label: '今年' },
            ]}
            placeholder="全部时间"
          />
          <CategoryDropdown
            value={sort}
            onChange={(v) => { setSort(v); setPage(0) }}
            options={[
              { value: 'comprehensive', label: '综合排序' },
              { value: 'created', label: '最新发布' },
              { value: 'likes', label: '最多点赞' },
            ]}
            placeholder="综合排序"
            hideClear
          />
          <div className="blog-view-toggle">
            <button
              className={`blog-view-btn ${view === 'grid' ? 'active' : ''}`}
              onClick={() => switchView('grid')}
              title="网格视图"
            >
              ▦ 网格
            </button>
            <button
              className={`blog-view-btn ${view === 'list' ? 'active' : ''}`}
              onClick={() => switchView('list')}
              title="列表视图"
            >
              ☰ 列表
            </button>
          </div>
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
            {view === 'grid' ? (
              <div className="blog-grid">
                {blogs.map(blog => (
                  <Reveal key={blog.id} className="blog-card">
                    <Link to={`/blogs/${blog.id}`} className="blog-card-link">
                      <div className="blog-card-body">
                        <h2 className="blog-card-title">
                          {blog.category && <span className="blog-card-category">{blog.category}</span>}
                          {blog.is_featured && <span className="blog-card-featured" title="精选">⭐</span>}
                          {blog.title}
                        </h2>
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
                    {isAdmin && (
                      <div className="blog-card-admin" onClick={e => e.preventDefault()}>
                        <button
                          className={`blog-card-featured-btn ${blog.is_featured ? 'active' : ''}`}
                          onClick={() => handleToggleFeatured(blog.id)}
                          title={blog.is_featured ? '取消精选' : '设为精选'}
                        >
                          ⭐
                        </button>
                        <CategoryDropdown
                          value={blog.category || ''}
                          onChange={(v) => handleSetCategory(blog.id, v)}
                          options={CATEGORIES.map(c => ({ value: c, label: c }))}
                          placeholder="未分类"
                          size="sm"
                        />
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
                  </Reveal>
                ))}
              </div>
            ) : (
              <div className="blog-list-view">
                {blogs.map((blog, i) => (
                  <div key={blog.id} className="blog-list-item" style={{ animationDelay: `${i * 60}ms` }}>
                    <Link to={`/blogs/${blog.id}`} className="blog-list-item-title">
                      {blog.is_featured && <span className="blog-list-featured" title="精选">⭐</span>}
                      {blog.title}
                    </Link>
                    <div className="blog-list-meta">
                      {blog.category && <span className="blog-card-category">{blog.category}</span>}
                      <span>{blog.author?.nickname || blog.author?.username || '匿名'}</span>
                      <span>{new Date(blog.created_at).toLocaleDateString('zh-CN')}</span>
                      <span>♥ {blog.like_count || 0}</span>
                      <span>💬 {blog.comment_count || 0}</span>
                    </div>
                    {isAdmin && (
                      <div className="blog-list-admin">
                        <button
                          className={`blog-card-featured-btn ${blog.is_featured ? 'active' : ''}`}
                          onClick={() => handleToggleFeatured(blog.id)}
                          title={blog.is_featured ? '取消精选' : '设为精选'}
                        >
                          ⭐ 精选
                        </button>
                        <CategoryDropdown
                          value={blog.category || ''}
                          onChange={(v) => handleSetCategory(blog.id, v)}
                          options={CATEGORIES.map(c => ({ value: c, label: c }))}
                          placeholder="未分类"
                          size="sm"
                        />
                        <button
                          className="blog-card-withdraw"
                          onClick={() => setWithdrawTarget({ id: blog.id, title: blog.title })}
                          title="撤回"
                        >
                          撤回
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

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
