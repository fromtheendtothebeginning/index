import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import CategoryDropdown from '../components/CategoryDropdown'
import { renderMd } from '../utils/markdown'
import './Blog.css'

const CATEGORIES = ['技术讨论', '更新日志', '娱乐论坛']

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
        <div className="comment-action-row">
          <button
            className={`comment-like-btn ${c.liked_by_me ? 'liked' : ''}`}
            onClick={() => handleCommentLike(c)}
            disabled={commentLikePending.has(c.id)}
            aria-label="评论点赞"
          >
            <span className="comment-like-icon">{c.liked_by_me ? '♥' : '♡'}</span>
            <span className="comment-like-count">{c.like_count || 0}</span>
          </button>
          <button className="comment-reply-btn" onClick={() => handleOpenReply(c)}>
            回复{c.reply_count > 0 ? ` (${c.reply_count})` : ''}
          </button>
          <button className="comment-chain-link" onClick={() => setChainCommentId(c.id)}>↗ 回复链</button>
        </div>
        {showReplyBox && (
          <form className="comment-inline-reply" onSubmit={handlePostReply}>
            <textarea
              className="comment-input"
              placeholder={`回复 @${c.user?.nickname || c.user?.username || '匿名'}`}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              rows={2}
              maxLength={2000}
              autoFocus
            />
            {replyError && <div className="form-server-error">{replyError}</div>}
            <div className="comment-form-actions">
              <button type="submit" className="btn btn-primary" disabled={replyPosting}>
                {replyPosting ? '发送中...' : '发送'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleCancelReply}>取消</button>
            </div>
          </form>
        )}
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
        if (!r.ok) throw new Error('博客不存在')
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
        alert(data.detail || '操作失败')
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
      alert('网络错误')
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
      setReplyError('回复内容不能为空')
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
        setReplyError(data.detail || '回复失败')
        return
      }
      // 重新拉取列表，刷新树、计数与 reply_count
      fetchComments()
      setReplyToId(null)
      setReplyText('')
      setBlog(b => b ? { ...b, comment_count: b.comment_count + 1 } : b)
    } catch {
      setReplyError('网络错误')
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
        alert(data.detail || '删除失败')
        return
      }
      setComments(prev => prev.filter(c => c.id !== commentToDelete))
      if (chainCommentId === commentToDelete) setChainCommentId(null)
      setBlog(b => b ? { ...b, comment_count: Math.max(0, b.comment_count - 1) } : b)
    } catch {
      alert('网络错误')
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
                <div title="管理员设置分类">
                  <CategoryDropdown
                    value={adminCategory}
                    onChange={handleAdminCategory}
                    options={CATEGORIES.map(c => ({ value: c, label: c }))}
                    placeholder="未分类"
                  />
                </div>
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

          {blog.project && (
            <Link to={`/projects/${blog.project.id}`} className="blog-project-link">
              <span className="blog-project-label">所属项目</span>
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
              ) : topLevelComments.length === 0 ? (
                <div className="comments-empty">还没有评论，来说点什么吧</div>
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
                          查看全部 {c.reply_count} 条回复
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
      {chainData && (
        <div className="modal-overlay comment-chain-overlay" onClick={() => setChainCommentId(null)}>
          <div className="modal-sheet comment-chain-panel" onClick={e => e.stopPropagation()}>
            <div className="comment-chain-header">
              <h3>回复链</h3>
              <button className="comment-chain-close" onClick={() => setChainCommentId(null)} title="关闭">×</button>
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
