import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { UiIcon } from './Icons'
import { apiFetch } from '../utils/api'
import { fmtDateTimeMinute } from '../utils/format'
import { t } from '../i18n'

// 博客详情页 / 项目详情页共用评论区。
// 评论点赞（POST /api/comments/{id}/like）与删除（DELETE /api/comments/{id}）两页同路径，组件内固定。
// 两页历史行为差异（有意保留，勿"顺手统一"，经 props 表达）：
// - blog: fetchWithAuth={false} —— 评论列表一直用裸 fetch（不带鉴权头，登录态首屏 liked_by_me 不含本人数据）
// - blog: loginPath="/login" —— 未登录发表评论跳 /login（/login 自身重定向到 /auth）；点赞/打开回复框两页均跳 /auth
// - blog: showChain —— 只渲染直接回复 + 「查看全部 N 条回复」+ 回复链面板；project 平铺全部后代回复
// - i18n 两页 key 路径不同但文案相同，见 KEY_VARIANTS
const KEY_VARIANTS = {
  blogDetail: {
    anonymous: 'blogDetail.anonymous',
    commentsTitle: 'blogDetail.commentsTitle',
    submit: 'blogDetail.comment.submit',
    likeAria: 'blogDetail.comment.likeAriaLabel',
    deleteFail: 'blogDetail.deleteFail',
    deleteMessage: 'blogDetail.comment.deleteMessage',
  },
  projectDetail: {
    anonymous: 'projectDetail.comment.anonymous',
    commentsTitle: 'projectDetail.comment.title',
    submit: 'projectDetail.comment.post',
    likeAria: 'projectDetail.comment.likeLabel',
    deleteFail: 'projectDetail.deleteFailed',
    deleteMessage: 'projectDetail.comment.deleteConfirmMessage',
  },
}

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
  replyText,
  setReplyText,
  replyPosting,
  replyError,
  onOpenChain,
  setCommentToDelete,
  p,
  V,
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
            {c.user?.nickname || c.user?.username || t(V.anonymous)}
          </span>
          <span className="comment-time">
            {fmtDateTimeMinute(c.created_at)}
          </span>
        </div>
        <div className="comment-content">{c.content}</div>
        <div className="comment-action-row">
          <button
            className={`comment-like-btn ${c.liked_by_me ? 'liked' : ''}`}
            onClick={() => handleCommentLike(c)}
            disabled={commentLikePending.has(c.id)}
            aria-label={t(V.likeAria)}
          >
            <span className="comment-like-icon"><UiIcon name="heart" filled={c.liked_by_me} size={14} /></span>
            <span className="comment-like-count">{c.like_count || 0}</span>
          </button>
          <button className="comment-reply-btn" onClick={() => handleOpenReply(c)}>
            {t(`${p}.comment.reply`)}{onOpenChain && c.reply_count > 0 ? ` (${c.reply_count})` : ''}
          </button>
          {onOpenChain && (
            <button className="comment-chain-link" onClick={() => onOpenChain(c.id)}>{t(`${p}.comment.chain`)}</button>
          )}
        </div>
        {showReplyBox && (
          <form className="comment-inline-reply" onSubmit={handlePostReply}>
            <textarea
              className="comment-input"
              placeholder={t(`${p}.comment.replyPlaceholder`, { name: c.user?.nickname || c.user?.username || t(V.anonymous) })}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              rows={2}
              maxLength={2000}
              autoFocus
            />
            {replyError && <div className="form-server-error">{replyError}</div>}
            <div className="comment-form-actions">
              <button type="submit" className="btn btn-primary" disabled={replyPosting}>
                {replyPosting ? t(`${p}.comment.sending`) : t(`${p}.comment.send`)}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleCancelReply}>{t(`${p}.comment.cancel`)}</button>
            </div>
          </form>
        )}
      </div>
      {user && (user.id === c.user_id || user.role === 'admin') && (
        <button
          className="comment-delete-btn"
          onClick={() => setCommentToDelete(c.id)}
          title={t(`${p}.comment.delete`)}
        >
          ×
        </button>
      )}
    </div>
  )
}

/**
 * @param {string} props.commentsUrl - 评论资源地址，GET 拉取与 POST 发表/回复共用（如 /api/blogs/{id}/comments）
 * @param {object|null} props.currentUser - 当前登录用户（null 为未登录）
 * @param {string} props.i18nPrefix - i18n key 前缀（"blogDetail" / "projectDetail"）
 * @param {string} [props.sectionId] - section 锚点 id（博客页 "comments"）
 * @param {string} [props.sectionClassName='comments-section']
 * @param {boolean} [props.showChain=false] - 直接回复 + 「查看全部」+ 回复链面板；false 时平铺全部后代回复
 * @param {string} [props.loginPath='/auth'] - 未登录时登录提示链接与发表评论跳转目标
 * @param {boolean} [props.fetchWithAuth=true] - 评论列表是否用 apiFetch（带鉴权头）
 * @param {function} [props.onCountChange] - 评论数变化回调（+1 发表/回复，-1 删除），父页同步计数用
 */
function CommentSection({
  commentsUrl,
  currentUser,
  i18nPrefix,
  sectionId,
  sectionClassName = 'comments-section',
  showChain = false,
  loginPath = '/auth',
  fetchWithAuth = true,
  onCountChange,
}) {
  const navigate = useNavigate()
  const p = i18nPrefix
  const V = KEY_VARIANTS[i18nPrefix] || KEY_VARIANTS.blogDetail

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

  // 加载评论列表（seq 防竞态：快速切换资源时旧响应不得覆盖新数据）
  const commentReqRef = useRef(0)
  const fetchComments = () => {
    const req = ++commentReqRef.current
    const get = fetchWithAuth ? apiFetch : fetch
    return get(commentsUrl)
      .then(r => r.json())
      .then(data => { if (req === commentReqRef.current) setComments(data.comments || []) })
      .catch(() => {})
  }

  useEffect(() => {
    setCommentsLoading(true)
    fetchComments().finally(() => setCommentsLoading(false))
  }, [commentsUrl, fetchWithAuth])

  const handlePostComment = async (e) => {
    e.preventDefault()
    const text = commentText.trim()
    if (!text) {
      setCommentError(t(`${p}.comment.contentRequired`))
      return
    }
    if (!currentUser) {
      navigate(loginPath)
      return
    }
    setCommentPosting(true)
    setCommentError('')
    try {
      const res = await apiFetch(commentsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCommentError(data.detail || t(`${p}.comment.postFailed`))
        return
      }
      setComments(prev => [...prev, data])
      setCommentText('')
      onCountChange?.(1)
    } catch {
      setCommentError(t(`${p}.networkError`))
    } finally {
      setCommentPosting(false)
    }
  }

  const handleCommentLike = async (c) => {
    if (!currentUser) {
      navigate('/auth')
      return
    }
    if (commentLikePending.has(c.id)) return
    setCommentLikePending(prev => new Set(prev).add(c.id))
    // 乐观更新
    const prevLiked = c.liked_by_me
    setComments(prev => prev.map(x => x.id === c.id
      ? { ...x, liked_by_me: !prevLiked, like_count: x.like_count + (prevLiked ? -1 : 1) }
      : x))
    try {
      const res = await apiFetch(`/api/comments/${c.id}/like`, {
        method: 'POST',
      })
      if (!res.ok) {
        // 回滚
        setComments(prev => prev.map(x => x.id === c.id
          ? { ...x, liked_by_me: prevLiked, like_count: c.like_count }
          : x))
        const data = await res.json().catch(() => ({}))
        alert(data.detail || t(`${p}.operationFailed`))
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
      alert(t(`${p}.networkError`))
    } finally {
      setCommentLikePending(prev => {
        const s = new Set(prev)
        s.delete(c.id)
        return s
      })
    }
  }

  const handleOpenReply = (c) => {
    if (!currentUser) {
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
      setReplyError(t(`${p}.comment.replyContentRequired`))
      return
    }
    if (!replyToId) return
    setReplyPosting(true)
    setReplyError('')
    try {
      const res = await apiFetch(commentsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: text, parent_id: replyToId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setReplyError(data.detail || t(`${p}.comment.replyFailed`))
        return
      }
      // 重新拉取列表，刷新树、计数与 reply_count
      fetchComments()
      setReplyToId(null)
      setReplyText('')
      onCountChange?.(1)
    } catch {
      setReplyError(t(`${p}.networkError`))
    } finally {
      setReplyPosting(false)
    }
  }

  const handleDeleteComment = async () => {
    if (!commentToDelete) return
    try {
      const res = await apiFetch(`/api/comments/${commentToDelete}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || t(V.deleteFail))
        return
      }
      setComments(prev => prev.filter(c => c.id !== commentToDelete))
      if (chainCommentId === commentToDelete) setChainCommentId(null)
      onCountChange?.(-1)
    } catch {
      alert(t(`${p}.networkError`))
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

  // 非链模式（项目页）：收集一条评论的全部后代（直接渲染全部子回复）
  const collectDescendants = (c) => {
    const out = []
    const walk = (node) => {
      const kids = childrenMap.get(node.id) || []
      kids.forEach(k => { out.push(k); walk(k) })
    }
    walk(c)
    return out
  }

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

  return (
    <>
      <section id={sectionId} className={sectionClassName}>
        <h3 className="comments-title">{t(V.commentsTitle)} {comments.length > 0 && <span className="comments-count">({comments.length})</span>}</h3>

        {currentUser ? (
          <form className="comment-form" onSubmit={handlePostComment}>
            <textarea
              className="comment-input"
              placeholder={t(`${p}.comment.placeholder`)}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              rows={3}
              maxLength={2000}
            />
            {commentError && <div className="form-server-error">{commentError}</div>}
            <div className="comment-form-actions">
              <button type="submit" className="btn btn-primary" disabled={commentPosting}>
                {commentPosting ? t(`${p}.comment.posting`) : t(V.submit)}
              </button>
            </div>
          </form>
        ) : (
          <div className="comment-login-hint">
            <Link to={loginPath}>{t(`${p}.comment.login`)}</Link> {t(`${p}.comment.loginHint`)}
          </div>
        )}

        <div className="comments-list">
          {commentsLoading ? (
            <div className="comments-empty">{t(`${p}.comment.loading`)}</div>
          ) : topLevelComments.length === 0 ? (
            <div className="comments-empty">{t(`${p}.comment.empty`)}</div>
          ) : (
            topLevelComments.map(c => {
              const replies = showChain ? (childrenMap.get(c.id) || []) : collectDescendants(c)
              return (
                <div className="comment-thread" key={c.id}>
                  <CommentCard
                    c={c}
                    showReplyBox={replyToId === c.id}
                    user={currentUser}
                    handleCommentLike={handleCommentLike}
                    commentLikePending={commentLikePending}
                    handleOpenReply={handleOpenReply}
                    handleCancelReply={handleCancelReply}
                    handlePostReply={handlePostReply}
                    replyText={replyText}
                    setReplyText={setReplyText}
                    replyPosting={replyPosting}
                    replyError={replyError}
                    onOpenChain={showChain ? setChainCommentId : null}
                    setCommentToDelete={setCommentToDelete}
                    p={p}
                    V={V}
                  />
                  {replies.length > 0 && (
                    <div className="comment-replies">
                      {replies.map(r => (
                        <div className="comment-reply" key={r.id}>
                          <CommentCard
                            c={r}
                            showReplyBox={replyToId === r.id}
                            user={currentUser}
                            handleCommentLike={handleCommentLike}
                            commentLikePending={commentLikePending}
                            handleOpenReply={handleOpenReply}
                            handleCancelReply={handleCancelReply}
                            handlePostReply={handlePostReply}
                            replyText={replyText}
                            setReplyText={setReplyText}
                            replyPosting={replyPosting}
                            replyError={replyError}
                            onOpenChain={showChain ? setChainCommentId : null}
                            setCommentToDelete={setCommentToDelete}
                            p={p}
                            V={V}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {showChain && c.reply_count > replies.length && (
                    <button className="comment-view-all" onClick={() => setChainCommentId(c.id)}>
                      {t(`${p}.comment.viewAllReplies`, { count: c.reply_count })}
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>

      <Modal
        open={!!commentToDelete}
        title={t(`${p}.comment.deleteTitle`)}
        message={t(V.deleteMessage)}
        confirmText={t(`${p}.confirmDelete`)}
        danger
        onConfirm={handleDeleteComment}
        onCancel={() => setCommentToDelete(null)}
      />
      {showChain && chainData && (
        <div className="modal-overlay comment-chain-overlay" onClick={() => setChainCommentId(null)}>
          <div className="modal-sheet comment-chain-panel" onClick={e => e.stopPropagation()}>
            <div className="comment-chain-header">
              <h3>{t(`${p}.comment.chainTitle`)}</h3>
              <button className="comment-chain-close" onClick={() => setChainCommentId(null)} title={t(`${p}.close`)}>×</button>
            </div>
            <div className="comment-chain-list">
              {chainData.chain.map((c, i) => (
                <CommentCard
                  key={c.id}
                  c={c}
                  chainDepth={i}
                  showReplyBox={replyToId === c.id}
                  user={currentUser}
                  handleCommentLike={handleCommentLike}
                  commentLikePending={commentLikePending}
                  handleOpenReply={handleOpenReply}
                  handleCancelReply={handleCancelReply}
                  handlePostReply={handlePostReply}
                  replyText={replyText}
                  setReplyText={setReplyText}
                  replyPosting={replyPosting}
                  replyError={replyError}
                  onOpenChain={setChainCommentId}
                  setCommentToDelete={setCommentToDelete}
                  p={p}
                  V={V}
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
                      user={currentUser}
                      handleCommentLike={handleCommentLike}
                      commentLikePending={commentLikePending}
                      handleOpenReply={handleOpenReply}
                      handleCancelReply={handleCancelReply}
                      handlePostReply={handlePostReply}
                      replyText={replyText}
                      setReplyText={setReplyText}
                      replyPosting={replyPosting}
                      replyError={replyError}
                      onOpenChain={setChainCommentId}
                      setCommentToDelete={setCommentToDelete}
                      p={p}
                      V={V}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default CommentSection
