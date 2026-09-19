import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import CategoryDropdown from '../components/CategoryDropdown'
import CommentSection from '../components/CommentSection'
import { renderMd } from '../utils/markdown'
import { apiFetch } from '../utils/api'
import { fmtDate, fmtDateLong } from '../utils/format'
import { UiIcon } from '../components/Icons'
import { BLOG_CATEGORIES as CATEGORIES } from '../constants'
import { t } from '../i18n'
import './Blog.css'

function BlogDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [blog, setBlog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // 点赞状态
  const [likePending, setLikePending] = useState(false)

  // 管理员分类
  const [adminCategory, setAdminCategory] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`/api/blogs/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(t('blogDetail.notFound'))
        return r.json()
      })
      .then(data => { if (!cancelled) setBlog(data) })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  // 同步管理员分类
  useEffect(() => {
    if (blog) setAdminCategory(blog.category || '')
  }, [blog])

  // 评论区计数同步（CommentSection 回调：+1 发表/回复，-1 删除）
  const handleCommentCountChange = (delta) =>
    setBlog(b => b ? { ...b, comment_count: Math.max(0, b.comment_count + delta) } : b)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/blogs/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.detail || t('blogDetail.deleteFail'))
        return
      }
      navigate('/blogs')
    } catch {
      alert(t('blogDetail.networkError'))
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleLike = async () => {
    if (!user) {
      navigate('/login')
      return
    }
    if (likePending || !blog) return
    setLikePending(true)
    // 乐观更新
    const prevLiked = blog.liked_by_me
    const prevCount = blog.like_count
    setBlog({
      ...blog,
      liked_by_me: !prevLiked,
      like_count: prevLiked ? prevCount - 1 : prevCount + 1,
    })
    try {
      const res = await apiFetch(`/api/blogs/${id}/like`, {
        method: 'POST',
      })
      if (!res.ok) {
        // 回滚
        setBlog({ ...blog, liked_by_me: prevLiked, like_count: prevCount })
        const data = await res.json().catch(() => ({}))
        alert(data.detail || t('blogDetail.operationFailed'))
        return
      }
      const data = await res.json()
      setBlog(b => b ? { ...b, liked_by_me: data.liked, like_count: data.like_count } : b)
    } catch {
      setBlog({ ...blog, liked_by_me: prevLiked, like_count: prevCount })
      alert(t('blogDetail.networkError'))
    } finally {
      setLikePending(false)
    }
  }

  if (loading) {
    return (
      <div className="blog-page">
        <div className="blog-main"><div className="blog-loading">{t('blogDetail.loading')}</div></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="blog-page">
        <div className="blog-main">
          <div className="blog-error">
            <h2>{error}</h2>
            <Link to="/blogs" className="btn btn-primary">{t('blogDetail.backToBlogs')}</Link>
          </div>
        </div>
      </div>
    )
  }

  const isAuthor = user && blog && user.id === blog.author_id
  const isAdmin = user && user.role === 'admin'

  const handleAdminCategory = async (newCat) => {
    setAdminCategory(newCat)
    if (!isAdmin || !blog) return
    setCategorySaving(true)
    try {
      const res = await apiFetch(`/api/admin/blogs/${blog.id}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCat || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || t('blogDetail.categoryUpdateFailed'))
        setAdminCategory(blog.category || '')
        return
      }
      setBlog(b => b ? { ...b, category: newCat || null } : b)
    } catch {
      alert(t('blogDetail.networkError'))
      setAdminCategory(blog.category || '')
    } finally {
      setCategorySaving(false)
    }
  }

  return (
    <div className="blog-page">
      <Navbar activePage="blog" />

      <div className="blog-main">
        <div className="blog-detail">
          <div className="blog-detail-nav">
            <Link to="/blogs" className="blog-back-link">{t('blogDetail.backToList')}</Link>
          </div>

          <h1 className="blog-detail-title">
            {blog.category && <span className="blog-card-category">{blog.category}</span>}
            {blog.title}
          </h1>
          <div className="blog-detail-meta">
            <span className="blog-detail-author">
              {t('blogDetail.author', { name: blog.author?.nickname || blog.author?.username || t('blogDetail.anonymous') })}
            </span>
            <span className="blog-detail-date">
              {fmtDateLong(blog.created_at)}
            </span>
          </div>

          {(isAuthor || isAdmin) && (
            <div className="blog-detail-actions">
              {(isAuthor || isAdmin) && <Link to={`/blogs/${blog.id}/edit`} className="btn-edit">{t('blogDetail.edit')}</Link>}
              {isAdmin && (
                <div title={t('blogDetail.adminSetCategory')}>
                  <CategoryDropdown
                    value={adminCategory}
                    onChange={handleAdminCategory}
                    options={CATEGORIES.map(c => ({ value: c, label: c }))}
                    placeholder={t('blogDetail.uncategorized')}
                  />
                </div>
              )}
              <button className="btn-delete" onClick={() => setShowDeleteModal(true)} disabled={deleting}>
                {deleting ? t('blogDetail.deleting') : (isAdmin && !isAuthor ? t('blogDetail.withdraw') : t('blogDetail.delete'))}
              </button>
            </div>
          )}

          <div
            className="blog-content markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMd(blog.content_md) }}
          />

          {blog.project && (
            <Link to={`/projects/${blog.project.id}`} className="blog-project-link">
              <span className="blog-project-label">{t('blogDetail.projectLabel')}</span>
              <span className="blog-project-name">{blog.project.name}</span>
              <span className="blog-project-arrow">&rarr;</span>
            </Link>
          )}

          {/* 互动栏：点赞 + 评论数 */}
          <div className="blog-interaction">
            <button
              className={`like-btn ${blog.liked_by_me ? 'liked' : ''}`}
              onClick={handleToggleLike}
              disabled={likePending}
              aria-label={t('blogDetail.likeAriaLabel')}
            >
              <span className="like-icon"><UiIcon name="heart" filled={blog.liked_by_me} size={14} /></span>
              <span className="like-count">{blog.like_count || 0}</span>
            </button>
            <a href="#comments" className="comment-count-link">
              <span className="comment-icon"><UiIcon name="message" size={14} /></span>
              <span>{t('blogDetail.commentCount', { count: blog.comment_count || 0 })}</span>
            </a>
          </div>

          {/* 评论区（共享组件） */}
          <CommentSection
            commentsUrl={`/api/blogs/${id}/comments`}
            currentUser={user}
            i18nPrefix="blogDetail"
            sectionId="comments"
            showChain
            loginPath="/login"
            fetchWithAuth={false}
            onCountChange={handleCommentCountChange}
          />
        </div>
      </div>

      <Modal
        open={showDeleteModal}
        title={t('blogDetail.confirmDelete')}
        message={isAdmin && !isAuthor ? t('blogDetail.deleteAdminMessage') : t('blogDetail.deleteMessage')}
        confirmText={deleting ? t('blogDetail.deleting') : t('blogDetail.confirmDelete')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  )
}

export default BlogDetailPage
