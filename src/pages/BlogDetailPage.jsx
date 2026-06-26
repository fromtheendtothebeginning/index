import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import { renderMd } from '../utils/markdown'
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

  // 点赞 / 评论相关状态
  const [likePending, setLikePending] = useState(false)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentPosting, setCommentPosting] = useState(false)
  const [commentError, setCommentError] = useState('')
  // 评论删除弹窗
  const [commentToDelete, setCommentToDelete] = useState(null)

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
    setLoading(true)
    const token = localStorage.getItem('token')
    fetch(`/api/blogs/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error('博客不存在')
        return r.json()
      })
      .then(data => setBlog(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  // 加载评论列表
  useEffect(() => {
    if (!id) return
    setCommentsLoading(true)
    fetch(`/api/blogs/${id}/comments`)
      .then(r => r.json())
      .then(data => setComments(data.comments || []))
      .catch(() => {})
      .finally(() => setCommentsLoading(false))
  }, [id])

  // 同步管理员分类
  useEffect(() => {
    if (blog) setAdminCategory(blog.category || '')
  }, [blog])

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

  const handleToggleLike = async () => {
    if (!user) {
      navigate('/login')
      return
    }
    if (likePending || !blog) return
    const token = localStorage.getItem('token')
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
      const res = await fetch(`/api/blogs/${id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        // 回滚
        setBlog({ ...blog, liked_by_me: prevLiked, like_count: prevCount })
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '操作失败')
        return
      }
      const data = await res.json()
      setBlog(b => b ? { ...b, liked_by_me: data.liked, like_count: data.like_count } : b)
    } catch {
      setBlog({ ...blog, liked_by_me: prevLiked, like_count: prevCount })
      alert('网络错误')
    } finally {
      setLikePending(false)
    }
  }

  const handlePostComment = async (e) => {
    e.preventDefault()
    const text = commentText.trim()
    if (!text) {
      setCommentError('评论内容不能为空')
      return
    }
    if (!user) {
      navigate('/login')
      return
    }
    const token = localStorage.getItem('token')
    setCommentPosting(true)
    setCommentError('')
    try {
      const res = await fetch(`/api/blogs/${id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCommentError(data.detail || '发表失败')
        return
      }
      setComments(prev => [...prev, data])
      setCommentText('')
      setBlog(b => b ? { ...b, comment_count: b.comment_count + 1 } : b)
    } catch {
      setCommentError('网络错误')
    } finally {
      setCommentPosting(false)
    }
  }

  const handleDeleteComment = async () => {
    if (!commentToDelete) return
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`/api/comments/${commentToDelete}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '删除失败')
        return
      }
      setComments(prev => prev.filter(c => c.id !== commentToDelete))
      setBlog(b => b ? { ...b, comment_count: Math.max(0, b.comment_count - 1) } : b)
    } catch {
      alert('网络错误')
    } finally {
      setCommentToDelete(null)
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
  const isAdmin = user && user.role === 'admin'

  const handleAdminCategory = async (newCat) => {
    setAdminCategory(newCat)
    if (!isAdmin || !blog) return
    setCategorySaving(true)
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`/api/admin/blogs/${blog.id}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ category: newCat || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '分类修改失败')
        setAdminCategory(blog.category || '')
        return
      }
      setBlog(b => b ? { ...b, category: newCat || null } : b)
    } catch {
      alert('网络错误')
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

          {(isAuthor || isAdmin) && (
            <div className="blog-detail-actions">
              {(isAuthor || isAdmin) && <Link to={`/blogs/${blog.id}/edit`} className="btn-edit">编辑</Link>}
              {isAdmin && (
                <select
                  className="admin-category-inline"
                  value={adminCategory}
                  onChange={(e) => handleAdminCategory(e.target.value)}
                  disabled={categorySaving}
                  title="管理员设置分类"
                >
                  <option value="">未分类</option>
                  <option value="技术讨论">技术讨论</option>
                  <option value="更新日志">更新日志</option>
                  <option value="娱乐论坛">娱乐论坛</option>
                </select>
              )}
              <button className="btn-delete" onClick={() => setShowDeleteModal(true)} disabled={deleting}>
                {deleting ? '删除中...' : (isAdmin && !isAuthor ? '撤回' : '删除')}
              </button>
            </div>
          )}

          <div
            className="blog-content markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMd(blog.content_md) }}
          />

          {/* 互动栏：点赞 + 评论数 */}
          <div className="blog-interaction">
            <button
              className={`like-btn ${blog.liked_by_me ? 'liked' : ''}`}
              onClick={handleToggleLike}
              disabled={likePending}
              aria-label="点赞"
            >
              <span className="like-icon">{blog.liked_by_me ? '♥' : '♡'}</span>
              <span className="like-count">{blog.like_count || 0}</span>
            </button>
            <a href="#comments" className="comment-count-link">
              <span className="comment-icon">💬</span>
              <span>{blog.comment_count || 0} 条评论</span>
            </a>
          </div>

          {/* 评论区 */}
          <section id="comments" className="comments-section">
            <h3 className="comments-title">评论 {comments.length > 0 && <span className="comments-count">({comments.length})</span>}</h3>

            {user ? (
              <form className="comment-form" onSubmit={handlePostComment}>
                <textarea
                  className="comment-input"
                  placeholder="写下你的评论..."
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
                {commentError && <div className="form-server-error">{commentError}</div>}
                <div className="comment-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={commentPosting}>
                    {commentPosting ? '发表中...' : '发表评论'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="comment-login-hint">
                <Link to="/login">登录</Link> 后参与评论
              </div>
            )}

            <div className="comments-list">
              {commentsLoading ? (
                <div className="comments-empty">加载评论中...</div>
              ) : comments.length === 0 ? (
                <div className="comments-empty">还没有评论，来说点什么吧</div>
              ) : (
                comments.map(c => (
                  <div key={c.id} className="comment-item">
                    <div className="comment-avatar">
                      {c.user?.avatar_url ? (
                        <img src={c.user.avatar_url} alt="" className="comment-avatar-img" />
                      ) : (
                        <span className="comment-avatar-letter">
                          {(c.user?.nickname || c.user?.username || '?').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="comment-body">
                      <div className="comment-header">
                        <span className="comment-author">
                          {c.user?.nickname || c.user?.username || '匿名'}
                        </span>
                        <span className="comment-time">
                          {new Date(c.created_at).toLocaleString('zh-CN', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="comment-content">{c.content}</div>
                    </div>
                    {user && (user.id === c.user_id || user.role === 'admin') && (
                      <button
                        className="comment-delete-btn"
                        onClick={() => setCommentToDelete(c.id)}
                        title="删除"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={showDeleteModal}
        title="确认删除"
        message={isAdmin && !isAuthor ? '管理员将撤回这篇博客，操作不可恢复。确定继续吗？' : '这篇博客将被永久删除，无法恢复。确定继续吗？'}
        confirmText={deleting ? '删除中...' : '确认删除'}
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
      <Modal
        open={!!commentToDelete}
        title="删除评论"
        message="确认删除这条评论？删除后无法恢复。"
        confirmText="确认删除"
        danger
        onConfirm={handleDeleteComment}
        onCancel={() => setCommentToDelete(null)}
      />
    </div>
  )
}

export default BlogDetailPage
