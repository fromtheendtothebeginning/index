import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import Reveal from '../components/Reveal'
import CategoryDropdown from '../components/CategoryDropdown'
import { UiIcon } from '../components/Icons'
import { ALL_CATEGORY, BLOG_CATEGORIES as CATEGORIES } from '../constants'
import { t } from '../i18n'
import './Blog.css'

const API_BASE = '/api'

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
  const [likePending, setLikePending] = useState(() => new Set())

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
    fetch(`${API_BASE}/blogs?${qs}`, { headers: authHeaders() })
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
        alert(d.detail || t('blogList.featuredUpdateFailed'))
        setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, is_featured: !next } : b))
      }
    } catch {
      alert(t('blogList.networkError'))
      setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, is_featured: !next } : b))
    }
  }

  // 点赞（乐观更新，未登录跳转登录页）
  const handleToggleLike = async (blogId) => {
    if (likePending.has(blogId)) return
    if (!user) {
      navigate('/auth')
      return
    }
    const blog = blogs.find(b => b.id === blogId)
    if (!blog) return
    const prevLiked = !!blog.liked_by_me
    const prevCount = blog.like_count || 0
    setLikePending(prev => new Set(prev).add(blogId))
    setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, liked_by_me: !prevLiked, like_count: prevCount + (prevLiked ? -1 : 1) } : b))
    try {
      const res = await fetch(`/api/blogs/${blogId}/like`, { method: 'POST', headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, liked_by_me: data.liked, like_count: data.like_count } : b))
      } else {
        setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, liked_by_me: prevLiked, like_count: prevCount } : b))
      }
    } catch {
      setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, liked_by_me: prevLiked, like_count: prevCount } : b))
    } finally {
      setLikePending(prev => {
        const next = new Set(prev)
        next.delete(blogId)
        return next
      })
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
        alert(d.detail || t('blogList.withdrawFailed'))
        return
      }
      setBlogs(prev => prev.filter(b => b.id !== withdrawTarget.id))
      setTotal(t => Math.max(0, t - 1))
    } catch {
      alert(t('blogList.networkError'))
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
        alert(d.detail || t('blogList.categoryUpdateFailed'))
        return
      }
      setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, category: newCat || null } : b))
    } catch {
      alert(t('blogList.networkError'))
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="blog-page">
      <Navbar activePage="blog" />

      <div className="blog-main">
        <Reveal className="blog-header">
          <div className="blog-header-content">
            <h1 className="blog-title">{t('blogList.title')}</h1>
            <p className="blog-subtitle">{t('blogList.subtitle')}</p>
          </div>
          {user && (
            <Link to="/blogs/new" className="btn btn-primary blog-write-btn">
              {t('blogList.write')}
            </Link>
          )}
        </Reveal>

        <div className="blog-toolbar">
          <input
            className="blog-search-input"
            placeholder={t('blogList.searchPlaceholder')}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <CategoryDropdown
            value={timeRange}
            onChange={(v) => { setTimeRange(v); setPage(0) }}
            options={[
              { value: '7d', label: t('blogList.time.last7d') },
              { value: '30d', label: t('blogList.time.last30d') },
              { value: 'year', label: t('blogList.time.year') },
            ]}
            placeholder={t('blogList.time.all')}
          />
          <CategoryDropdown
            value={sort}
            onChange={(v) => { setSort(v); setPage(0) }}
            options={[
              { value: 'comprehensive', label: t('blogList.sort.comprehensive') },
              { value: 'created', label: t('blogList.sort.created') },
              { value: 'likes', label: t('blogList.sort.likes') },
            ]}
            placeholder={t('blogList.sort.comprehensive')}
            hideClear
          />
          <div className="blog-view-toggle">
            <button
              className={`blog-view-btn ${view === 'grid' ? 'active' : ''}`}
              onClick={() => switchView('grid')}
              title={t('blogList.view.gridTitle')}
            >
              {t('blogList.view.grid')}
            </button>
            <button
              className={`blog-view-btn ${view === 'list' ? 'active' : ''}`}
              onClick={() => switchView('list')}
              title={t('blogList.view.listTitle')}
            >
              {t('blogList.view.list')}
            </button>
          </div>
        </div>

        <div className="blog-filters">
          {[ALL_CATEGORY, ...CATEGORIES].map(cat => (
            <button
              key={cat || 'all'}
              className={`blog-filter-btn ${filterCategory === cat ? 'active' : ''}`}
              onClick={() => { setFilterCategory(cat); setPage(0) }}
            >
              {cat || t('blogList.category.all')}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="blog-loading">{t('blogList.loading')}</div>
        ) : blogs.length === 0 ? (
          <div className="blog-empty">
            <p>{t('blogList.empty')}</p>
            {user && <Link to="/blogs/new" className="btn btn-primary">{t('blogList.writeFirst')}</Link>}
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
                          {blog.is_featured && <span className="blog-card-featured" title={t('blogList.featured')}><UiIcon name="star" filled size={14} /></span>}
                          {blog.title}
                        </h2>
                        <div className="blog-card-meta">
                          <span className="blog-card-author">
                            {blog.author?.nickname || blog.author?.username || t('blogList.anonymous')}
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
                          title={blog.is_featured ? t('blogList.unfeatured') : t('blogList.setFeatured')}
                        >
                          <UiIcon name="star" size={13} />
                        </button>
                        <CategoryDropdown
                          value={blog.category || ''}
                          onChange={(v) => handleSetCategory(blog.id, v)}
                          options={CATEGORIES.map(c => ({ value: c, label: c }))}
                          placeholder={t('blogList.uncategorized')}
                          size="sm"
                        />
                        <button
                          className="blog-card-withdraw"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setWithdrawTarget({ id: blog.id, title: blog.title })
                          }}
                          title={t('blogList.withdraw')}
                        >
                          {t('blogList.withdraw')}
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
                      {blog.is_featured && <span className="blog-list-featured" title={t('blogList.featured')}><UiIcon name="star" filled size={14} /></span>}
                      {blog.title}
                    </Link>
                    <div className="blog-list-meta">
                      {blog.category && <span className="blog-card-category">{blog.category}</span>}
                      <span>{blog.author?.nickname || blog.author?.username || t('blogList.anonymous')}</span>
                      <span>{new Date(blog.created_at).toLocaleDateString('zh-CN')}</span>
                      <button
                        type="button"
                        className={`blog-list-like ${blog.liked_by_me ? 'liked' : ''}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleToggleLike(blog.id)
                        }}
                      >
                        <UiIcon name="heart" filled={blog.liked_by_me} size={13} /> {blog.like_count || 0}
                      </button>
                      <span><UiIcon name="message" size={13} /> {blog.comment_count || 0}</span>
                    </div>
                    {isAdmin && (
                      <div className="blog-list-admin">
                        <button
                          className={`blog-card-featured-btn ${blog.is_featured ? 'active' : ''}`}
                          onClick={() => handleToggleFeatured(blog.id)}
                          title={blog.is_featured ? t('blogList.unfeatured') : t('blogList.setFeatured')}
                        >
                          <UiIcon name="star" size={13} /> {t('blogList.featured')}
                        </button>
                        <CategoryDropdown
                          value={blog.category || ''}
                          onChange={(v) => handleSetCategory(blog.id, v)}
                          options={CATEGORIES.map(c => ({ value: c, label: c }))}
                          placeholder={t('blogList.uncategorized')}
                          size="sm"
                        />
                        <button
                          className="blog-card-withdraw"
                          onClick={() => setWithdrawTarget({ id: blog.id, title: blog.title })}
                          title={t('blogList.withdraw')}
                        >
                          {t('blogList.withdraw')}
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
                  {t('blogList.prevPage')}
                </button>
                <span className="pagination-info">{page + 1} / {totalPages}</span>
                <button
                  className="pagination-btn"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                >
                  {t('blogList.nextPage')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        open={!!withdrawTarget}
        title={t('blogList.withdrawTitle')}
        message={withdrawTarget ? t('blogList.withdrawMessage', { title: withdrawTarget.title }) : ''}
        confirmText={t('blogList.withdrawConfirm')}
        danger
        onConfirm={handleWithdraw}
        onCancel={() => setWithdrawTarget(null)}
      />
    </div>
  )
}

export default BlogListPage
