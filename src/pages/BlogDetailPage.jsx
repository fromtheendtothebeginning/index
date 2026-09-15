import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import CategoryDropdown from '../components/CategoryDropdown'
import { renderMd } from '../utils/markdown'
import { UiIcon } from '../components/Icons'
import { BLOG_CATEGORIES as CATEGORIES } from '../constants'
import { t } from '../i18n'
import './Blog.css'

// 单条评论卡片（主列表 / 回复链面板共用）
function CommentCard({
  c,
  chainDepth = null,
  showReplyBox = false,
  user,
  handleCommentLike,
  commentLikePending,
  handleOpenReply,
  handleCancelReply,
  handlePostReply,
  replyToId,
  replyText,
  setReplyText,
  replyPosting,
  replyError,
  setChainCommentId,
  setCommentToDelete,
}) {
  return (
    <div
      className={`comment-item ${chainDepth !== null ? 'comment-chain-item' : ''}`}
      style={chainDepth !== null ? { marginLeft: chainDepth * (window.innerWidth < 768 ? 14 : 28) } : undefined}
    >
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
            {c.user?.nickname || c.user?.username || t('blogDetail.anonymous')}
          </span>
          <span className="comment-time">
            {new Date(c.created_at).toLocaleString('zh-CN', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit'
            })}
          </span>
        </div>
        <div className="comment-content">{c.content}</div>
        <div className="comment-action-row">
          <button
            className={`comment-like-btn ${c.liked_by_me ? 'liked' : ''}`}
            onClick={() => handleCommentLike(c)}
            disabled={commentLikePending.has(c.id)}
            aria-label={t('blogDetail.comment.likeAriaLabel')}
          >
            <span className="comment-like-icon"><UiIcon name="heart" filled={c.liked_by_me} size={14} /></span>
            <span className="comment-like-count">{c.like_count || 0}</span>
          </button>
          <button className="comment-reply-btn" onClick={() => handleOpenReply(c)}>
            {t('blogDetail.comment.reply')}{c.reply_count > 0 ? ` (${c.reply_count})` : ''}
          </button>
          <button className="comment-chain-link" onClick={() => setChainCommentId(c.id)}>{t('blogDetail.comment.chain')}</button>
        </div>
        {showReplyBox && (
          <form className="comment-inline-reply" onSubmit={handlePostReply}>
            <textarea
              className="comment-input"
              placeholder={t('blogDetail.comment.replyPlaceholder', { name: c.user?.nickname || c.user?.username || t('blogDetail.anonymous') })}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              rows={2}
              maxLength={2000}
              autoFocus
            />
            {replyError && <div className="form-server-error">{replyError}</div>}
            <div className="comment-form-actions">
              <button type="submit" className="btn btn-primary" disabled={replyPosting}>
                {replyPosting ? t('blogDetail.comment.sending') : t('blogDetail.comment.send')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleCancelReply}>{t('blogDetail.comment.cancel')}</button>
            </div>
          </form>
        )}
      </div>
      {user && (user.id === c.user_id || user.role === 'admin') && (
        <button
          className="comment-delete-btn"
          onClick={() => setCommentToDelete(c.id)}
          title={t('blogDetail.comment.delete')}
        >
          ×
        </button>
      )}
    </div>
  )
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

  // 点赞 / 评论相关状态
  const [likePending, setLikePending] = useState(false)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentPosting, setCommentPosting] = useState(false)
  const [commentError, setCommentError] = useState('')
  // 评论点赞 / 回复 / 回复链状态
  const [commentLikePending, setCommentLikePending] = useState(() => new Set())
  const [replyToId, setReplyToId] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [replyPosting, setReplyPosting] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [chainCommentId, setChainCommentId] = useState(null)
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
        if (!r.ok) throw new Error(t('blogDetail.notFound'))
        return r.json()
      })
      .then(data => setBlog(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  // 加载评论列表
  const fetchComments = () => {
    return fetch(`/api/blogs/${id}/comments`)
      .then(r => r.json())
      .then(data => setComments(data.comments || []))
      .catch(() => {})
  }

  useEffect(() => {
    if (!id) return
    setCommentsLoading(true)
    fetchComments()
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

  const handlePostComment = async (e) => {
    e.preventDefault()
    const text = commentText.trim()
    if (!text) {
      setCommentError(t('blogDetail.comment.contentRequired'))
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
        setCommentError(data.detail || t('blogDetail.comment.postFailed'))
        return
      }
      setComments(prev => [...prev, data])
      setCommentText('')
      setBlog(b => b ? { ...b, comment_count: b.comment_count + 1 } : b)
    } catch {
      setCommentError(t('blogDetail.networkError'))
    } finally {
      setCommentPosting(false)
    }
  }

  const handleCommentLike = async (c) => {
    if (!user) {
      navigate('/auth')
      return
    }
    if (commentLikePending.has(c.id)) return
    const token = localStorage.getItem('token')
    setCommentLikePending(prev => new Set(prev).add(c.id))
    // 乐观更新
    const prevLiked = c.liked_by_me
    setComments(prev => prev.map(x => x.id === c.id
      ? { ...x, liked_by_me: !prevLiked, like_count: x.like_count + (prevLiked ? -1 : 1) }
      : x))
    try {
      const res = await fetch(`/api/comments/${c.id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        // 回滚
        setComments(prev => prev.map(x => x.id === c.id
          ? { ...x, liked_by_me: prevLiked, like_count: c.like_count }
          : x))
        const data = await res.json().catch(() => ({}))
        alert(data.detail || t('blogDetail.operationFailed'))
        return
      }
      const data = await res.json()
      setComments(prev => prev.map(x => x.id === c.id
        ? { ...x, liked_by_me: data.liked, like_count: data.like_count }
        : x))
    } catch {
      setComments(prev => prev.map(x => x.id === c.id
        ? { ...x, liked_by_me: prevLiked, like_count: c.like_count }
        : x))
      alert(t('blogDetail.networkError'))
    } finally {
      setCommentLikePending(prev => {
        const s = new Set(prev)
        s.delete(c.id)
        return s
      })
    }
  }

  const handleOpenReply = (c) => {
    if (!user) {
      navigate('/auth')
      return
    }
    setReplyToId(c.id)
    setReplyText('')
    setReplyError('')
  }

  const handleCancelReply = () => {
    setReplyToId(null)
    setReplyText('')
    setReplyError('')
  }

  const handlePostReply = async (e) => {
    e.preventDefault()
    const text = replyText.trim()
    if (!text) {
      setReplyError(t('blogDetail.comment.replyContentRequired'))
      return
    }
    if (!replyToId) return
    const token = localStorage.getItem('token')
    setReplyPosting(true)
    setReplyError('')
    try {
      const res = await fetch(`/api/blogs/${id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text, parent_id: replyToId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setReplyError(data.detail || t('blogDetail.comment.replyFailed'))
        return
      }
      // 重新拉取列表，刷新树、计数与 reply_count
      fetchComments()
      setReplyToId(null)
      setReplyText('')
      setBlog(b => b ? { ...b, comment_count: b.comment_count + 1 } : b)
    } catch {
      setReplyError(t('blogDetail.networkError'))
    } finally {
      setReplyPosting(false)
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
        alert(data.detail || t('blogDetail.deleteFail'))
        return
      }
      setComments(prev => prev.filter(c => c.id !== commentToDelete))
      if (chainCommentId === commentToDelete) setChainCommentId(null)
      setBlog(b => b ? { ...b, comment_count: Math.max(0, b.comment_count - 1) } : b)
    } catch {
      alert(t('blogDetail.networkError'))
    } finally {
      setCommentToDelete(null)
    }
  }

  // 评论树：扁平列表 → 父到子的映射
  const { childrenMap, commentById, topLevelComments } = useMemo(() => {
    const map = new Map()
    const byId = new Map()
    comments.forEach(c => {
      byId.set(c.id, c)
      if (!map.has(c.parent_id)) map.set(c.parent_id, [])
      map.get(c.parent_id).push(c)
    })
    return {
      childrenMap: map,
      commentById: byId,
      topLevelComments: map.get(null) || [],
    }
  }, [comments])

  // 回复链面板：从当前评论沿 parent_id 回溯到根（根在前、当前在后）
  const chainData = useMemo(() => {
    if (!chainCommentId) return null
    const chain = []
    let cur = commentById.get(chainCommentId)
    while (cur) {
      chain.unshift(cur)
      cur = cur.parent_id ? (commentById.get(cur.parent_id) || null) : null
    }
    if (chain.length === 0) return null
    const current = chain[chain.length - 1]
    return { chain, children: childrenMap.get(current.id) || [] }
  }, [chainCommentId, commentById, childrenMap])

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
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`/api/admin/blogs/${blog.id}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
              {new Date(blog.created_at).toLocaleDateString('zh-CN', {
                year: 'numeric', month: 'long', day: 'numeric'
              })}
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

          {/* 评论区 */}
          <section id="comments" className="comments-section">
            <h3 className="comments-title">{t('blogDetail.commentsTitle')} {comments.length > 0 && <span className="comments-count">({comments.length})</span>}</h3>

            {user ? (
              <form className="comment-form" onSubmit={handlePostComment}>
                <textarea
                  className="comment-input"
                  placeholder={t('blogDetail.comment.placeholder')}
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
                {commentError && <div className="form-server-error">{commentError}</div>}
                <div className="comment-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={commentPosting}>
                    {commentPosting ? t('blogDetail.comment.posting') : t('blogDetail.comment.submit')}
                  </button>
                </div>
              </form>
            ) : (
              <div className="comment-login-hint">
                <Link to="/login">{t('blogDetail.comment.login')}</Link> {t('blogDetail.comment.loginHint')}
              </div>
            )}

            <div className="comments-list">
              {commentsLoading ? (
                <div className="comments-empty">{t('blogDetail.comment.loading')}</div>
              ) : topLevelComments.length === 0 ? (
                <div className="comments-empty">{t('blogDetail.comment.empty')}</div>
              ) : (
                topLevelComments.map(c => {
                  const directReplies = childrenMap.get(c.id) || []
                  return (
                    <div className="comment-thread" key={c.id}>
                      <CommentCard
                        c={c}
                        showReplyBox={replyToId === c.id}
                        user={user}
                        handleCommentLike={handleCommentLike}
                        commentLikePending={commentLikePending}
                        handleOpenReply={handleOpenReply}
                        handleCancelReply={handleCancelReply}
                        handlePostReply={handlePostReply}
                        replyToId={replyToId}
                        replyText={replyText}
                        setReplyText={setReplyText}
                        replyPosting={replyPosting}
                        replyError={replyError}
                        setChainCommentId={setChainCommentId}
                        setCommentToDelete={setCommentToDelete}
                      />
                      {directReplies.length > 0 && (
                        <div className="comment-replies">
                          {directReplies.map(r => (
                            <div className="comment-reply" key={r.id}>
                              <CommentCard
                                c={r}
                                showReplyBox={replyToId === r.id}
                                user={user}
                                handleCommentLike={handleCommentLike}
                                commentLikePending={commentLikePending}
                                handleOpenReply={handleOpenReply}
                                handleCancelReply={handleCancelReply}
                                handlePostReply={handlePostReply}
                                replyToId={replyToId}
                                replyText={replyText}
                                setReplyText={setReplyText}
                                replyPosting={replyPosting}
                                replyError={replyError}
                                setChainCommentId={setChainCommentId}
                                setCommentToDelete={setCommentToDelete}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {c.reply_count > directReplies.length && (
                        <button className="comment-view-all" onClick={() => setChainCommentId(c.id)}>
                          {t('blogDetail.comment.viewAllReplies', { count: c.reply_count })}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>
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
      <Modal
        open={!!commentToDelete}
        title={t('blogDetail.comment.deleteTitle')}
        message={t('blogDetail.comment.deleteMessage')}
        confirmText={t('blogDetail.confirmDelete')}
        danger
        onConfirm={handleDeleteComment}
        onCancel={() => setCommentToDelete(null)}
      />
      {chainData && (
        <div className="modal-overlay comment-chain-overlay" onClick={() => setChainCommentId(null)}>
          <div className="modal-sheet comment-chain-panel" onClick={e => e.stopPropagation()}>
            <div className="comment-chain-header">
              <h3>{t('blogDetail.comment.chainTitle')}</h3>
              <button className="comment-chain-close" onClick={() => setChainCommentId(null)} title={t('blogDetail.close')}>×</button>
            </div>
            <div className="comment-chain-list">
              {chainData.chain.map((c, i) => (
                <CommentCard
                  key={c.id}
                  c={c}
                  chainDepth={i}
                  showReplyBox={replyToId === c.id}
                  user={user}
                  handleCommentLike={handleCommentLike}
                  commentLikePending={commentLikePending}
                  handleOpenReply={handleOpenReply}
                  handleCancelReply={handleCancelReply}
                  handlePostReply={handlePostReply}
                  replyToId={replyToId}
                  replyText={replyText}
                  setReplyText={setReplyText}
                  replyPosting={replyPosting}
                  replyError={replyError}
                  setChainCommentId={setChainCommentId}
                  setCommentToDelete={setCommentToDelete}
                />
              ))}
              {chainData.children.length > 0 && (
                <div className="comment-chain-children">
                  {chainData.children.map(c => (
                    <CommentCard
                      key={c.id}
                      c={c}
                      chainDepth={chainData.chain.length}
                      showReplyBox={replyToId === c.id}
                      user={user}
                      handleCommentLike={handleCommentLike}
                      commentLikePending={commentLikePending}
                      handleOpenReply={handleOpenReply}
                      handleCancelReply={handleCancelReply}
                      handlePostReply={handlePostReply}
                      replyToId={replyToId}
                      replyText={replyText}
                      setReplyText={setReplyText}
                      replyPosting={replyPosting}
                      replyError={replyError}
                      setChainCommentId={setChainCommentId}
                      setCommentToDelete={setCommentToDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BlogDetailPage
