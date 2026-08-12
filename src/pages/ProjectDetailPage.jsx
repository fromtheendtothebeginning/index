import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import ProjectCover from '../components/ProjectCover'
import Reveal from '../components/Reveal'
import { renderMd } from '../utils/markdown'
import { UiIcon } from '../components/Icons'
import './Project.css'

// 单条项目评论卡片（顶层 / 子回复共用）
function ProjectCommentItem({
  c,
  user,
  showReplyBox = false,
  handleLike,
  likePending,
  onOpenReply,
  onCancelReply,
  onPostReply,
  replyText,
  setReplyText,
  replyPosting,
  replyError,
  onDelete,
}) {
  const canDelete = user && (
    (c.user_id && user.id === c.user_id) ||
    (c.user && user.id === c.user.id) ||
    user.role === 'admin'
  )
  return (
    <div className="comment-item">
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
            onClick={() => handleLike(c)}
            disabled={likePending.has(c.id)}
            aria-label="评论点赞"
          >
            <span className="comment-like-icon"><UiIcon name="heart" filled={c.liked_by_me} size={14} /></span>
            <span className="comment-like-count">{c.like_count || 0}</span>
          </button>
          <button className="comment-reply-btn" onClick={() => onOpenReply(c)}>回复</button>
        </div>
        {showReplyBox && (
          <form className="comment-inline-reply" onSubmit={onPostReply}>
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
              <button type="button" className="btn btn-secondary" onClick={onCancelReply}>取消</button>
            </div>
          </form>
        )}
      </div>
      {canDelete && (
        <button
          className="comment-delete-btn"
          onClick={() => onDelete(c.id)}
          title="删除"
        >
          ×
        </button>
      )}
    </div>
  )
}

function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  // 点赞 / 关注
  const [projectLikePending, setProjectLikePending] = useState(false)
  const [projectFollowPending, setProjectFollowPending] = useState(false)
  // 评论区
  const [projectComments, setProjectComments] = useState([])
  const [projCommentsLoading, setProjCommentsLoading] = useState(false)
  const [projCommentText, setProjCommentText] = useState('')
  const [projCommentPosting, setProjCommentPosting] = useState(false)
  const [projCommentError, setProjCommentError] = useState('')
  const [projCommentLikePending, setProjCommentLikePending] = useState(() => new Set())
  const [projReplyToId, setProjReplyToId] = useState(null)
  const [projReplyText, setProjReplyText] = useState('')
  const [projReplyPosting, setProjReplyPosting] = useState(false)
  const [projReplyError, setProjReplyError] = useState('')
  const [projCommentToDelete, setProjCommentToDelete] = useState(null)

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    const token = localStorage.getItem('token')
    fetch(`/api/projects/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error('项目不存在')
        return r.json()
      })
      .then(data => setProject(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  // 加载评论列表
  const fetchProjectComments = () => {
    const token = localStorage.getItem('token')
    return fetch(`/api/projects/${id}/comments`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => setProjectComments(data.comments || []))
      .catch(() => {})
  }

  useEffect(() => {
    if (!id) return
    setProjCommentsLoading(true)
    fetchProjectComments().finally(() => setProjCommentsLoading(false))
  }, [id])

  const handleDelete = async () => {
    const token = localStorage.getItem('token')
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '删除失败')
        return
      }
      navigate('/projects')
    } catch {
      alert('网络错误')
    } finally {
      setDeleting(false)
    }
  }

  const handleProjectLike = async () => {
    if (!user) {
      navigate('/auth')
      return
    }
    if (projectLikePending || !project) return
    const token = localStorage.getItem('token')
    setProjectLikePending(true)
    // 乐观更新
    const prevLiked = project.liked_by_me
    const prevCount = project.like_count
    setProject({
      ...project,
      liked_by_me: !prevLiked,
      like_count: prevLiked ? prevCount - 1 : prevCount + 1,
    })
    try {
      const res = await fetch(`/api/projects/${id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setProject({ ...project, liked_by_me: prevLiked, like_count: prevCount })
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '操作失败')
        return
      }
      const data = await res.json()
      setProject(p => p ? { ...p, liked_by_me: data.liked, like_count: data.like_count } : p)
    } catch {
      setProject({ ...project, liked_by_me: prevLiked, like_count: prevCount })
      alert('网络错误')
    } finally {
      setProjectLikePending(false)
    }
  }

  const handleProjectFollow = async () => {
    if (!user) {
      navigate('/auth')
      return
    }
    if (projectFollowPending || !project) return
    const token = localStorage.getItem('token')
    setProjectFollowPending(true)
    // 乐观更新
    const prevFollowed = project.followed_by_me
    const prevCount = project.follow_count
    setProject({
      ...project,
      followed_by_me: !prevFollowed,
      follow_count: prevFollowed ? prevCount - 1 : prevCount + 1,
    })
    try {
      const res = await fetch(`/api/projects/${id}/follow`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setProject({ ...project, followed_by_me: prevFollowed, follow_count: prevCount })
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '操作失败')
        return
      }
      const data = await res.json()
      setProject(p => p ? { ...p, followed_by_me: data.followed, follow_count: data.follow_count } : p)
    } catch {
      setProject({ ...project, followed_by_me: prevFollowed, follow_count: prevCount })
      alert('网络错误')
    } finally {
      setProjectFollowPending(false)
    }
  }

  const handleProjPostComment = async (e) => {
    e.preventDefault()
    const text = projCommentText.trim()
    if (!text) {
      setProjCommentError('评论内容不能为空')
      return
    }
    if (!user) {
      navigate('/auth')
      return
    }
    const token = localStorage.getItem('token')
    setProjCommentPosting(true)
    setProjCommentError('')
    try {
      const res = await fetch(`/api/projects/${id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setProjCommentError(data.detail || '发表失败')
        return
      }
      setProjectComments(prev => [...prev, data])
      setProjCommentText('')
    } catch {
      setProjCommentError('网络错误')
    } finally {
      setProjCommentPosting(false)
    }
  }

  const handleProjCommentLike = async (c) => {
    if (!user) {
      navigate('/auth')
      return
    }
    if (projCommentLikePending.has(c.id)) return
    const token = localStorage.getItem('token')
    setProjCommentLikePending(prev => new Set(prev).add(c.id))
    // 乐观更新
    const prevLiked = c.liked_by_me
    setProjectComments(prev => prev.map(x => x.id === c.id
      ? { ...x, liked_by_me: !prevLiked, like_count: x.like_count + (prevLiked ? -1 : 1) }
      : x))
    try {
      const res = await fetch(`/api/comments/${c.id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setProjectComments(prev => prev.map(x => x.id === c.id
          ? { ...x, liked_by_me: prevLiked, like_count: c.like_count }
          : x))
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '操作失败')
        return
      }
      const data = await res.json()
      setProjectComments(prev => prev.map(x => x.id === c.id
        ? { ...x, liked_by_me: data.liked, like_count: data.like_count }
        : x))
    } catch {
      setProjectComments(prev => prev.map(x => x.id === c.id
        ? { ...x, liked_by_me: prevLiked, like_count: c.like_count }
        : x))
      alert('网络错误')
    } finally {
      setProjCommentLikePending(prev => {
        const s = new Set(prev)
        s.delete(c.id)
        return s
      })
    }
  }

  const handleProjOpenReply = (c) => {
    if (!user) {
      navigate('/auth')
      return
    }
    setProjReplyToId(c.id)
    setProjReplyText('')
    setProjReplyError('')
  }

  const handleProjCancelReply = () => {
    setProjReplyToId(null)
    setProjReplyText('')
    setProjReplyError('')
  }

  const handleProjPostReply = async (e) => {
    e.preventDefault()
    const text = projReplyText.trim()
    if (!text) {
      setProjReplyError('回复内容不能为空')
      return
    }
    if (!projReplyToId) return
    const token = localStorage.getItem('token')
    setProjReplyPosting(true)
    setProjReplyError('')
    try {
      const res = await fetch(`/api/projects/${id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text, parent_id: projReplyToId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setProjReplyError(data.detail || '回复失败')
        return
      }
      // 重新拉取列表，刷新树与回复数
      fetchProjectComments()
      setProjReplyToId(null)
      setProjReplyText('')
    } catch {
      setProjReplyError('网络错误')
    } finally {
      setProjReplyPosting(false)
    }
  }

  const handleProjDeleteComment = async () => {
    if (!projCommentToDelete) return
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`/api/comments/${projCommentToDelete}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '删除失败')
        return
      }
      setProjectComments(prev => prev.filter(c => c.id !== projCommentToDelete))
    } catch {
      alert('网络错误')
    } finally {
      setProjCommentToDelete(null)
    }
  }

  // 评论树：扁平列表 → 父到子的映射
  const { projChildrenMap, projTopLevel } = useMemo(() => {
    const map = new Map()
    projectComments.forEach(c => {
      if (!map.has(c.parent_id)) map.set(c.parent_id, [])
      map.get(c.parent_id).push(c)
    })
    return {
      projChildrenMap: map,
      projTopLevel: map.get(null) || [],
    }
  }, [projectComments])

  // 收集一条评论的全部后代（简化：直接渲染全部子回复）
  const collectDescendants = (c) => {
    const out = []
    const walk = (node) => {
      const kids = projChildrenMap.get(node.id) || []
      kids.forEach(k => { out.push(k); walk(k) })
    }
    walk(c)
    return out
  }

  const isAuthor = user && project && user.id === project.author_id
  const isAdmin = user && user.role === 'admin'

  if (loading) {
    return (
      <div className="project-page">
        <div className="project-main"><div className="blog-loading">加载中...</div></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="project-page">
        <div className="project-main">
          <div className="blog-error">
            <h2>{error}</h2>
            <Link to="/projects" className="btn btn-primary">&larr; 返回项目列表</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="project-page">
      <Navbar activePage="project" />
      <div className="project-main">
        <div className="project-detail">
          <div className="blog-detail-nav">
            <Link to="/projects" className="blog-back-link">&larr; 返回项目列表</Link>
          </div>

          <Reveal>
            {project.cover_url ? (
              <ProjectCover src={project.cover_url} alt={project.name} className="project-detail-cover" bgColor={project.bg_color} />
            ) : (
              <div className="project-detail-cover project-cover-placeholder">
                {project.name.charAt(0)}
              </div>
            )}
          </Reveal>

          <Reveal as="h1" className="project-detail-title">{project.name}</Reveal>
          {project.tags && project.tags.length > 0 && (
            <Reveal className="project-detail-tags">
              {project.tags.map(t => <span key={t} className="tag">{t}</span>)}
            </Reveal>
          )}
          <Reveal className="blog-detail-meta">
            <span className="blog-detail-author">
              作者：{project.author?.nickname || project.author?.username || '匿名'}
            </span>
            <span className="blog-detail-date">
              {new Date(project.created_at).toLocaleDateString('zh-CN', {
                year: 'numeric', month: 'long', day: 'numeric'
              })}
            </span>
          </Reveal>

          {(isAuthor || isAdmin) && (
            <div className="project-actions">
              <Link to={`/projects/${project.id}/edit`} className="btn-edit">编辑</Link>
              <button className="btn-delete" onClick={() => setShowDeleteModal(true)} disabled={deleting}>
                {deleting ? '删除中...' : '删除'}
              </button>
            </div>
          )}

          {(project.links && project.links.length > 0) && (
            <div className="project-actions project-link-actions">
              {project.links.map((l, i) => (
                <a
                  key={i}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="project-link-btn"
                >
                  {/github\.com/i.test(l.url) ? `GitHub ↗` : `${l.name} ↗`}
                </a>
              ))}
            </div>
          )}
          {(!(project.links && project.links.length > 0) && project.link_url) && (
            <div className="project-actions">
              <a
                href={project.link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="project-link-btn"
              >
                {/github\.com/i.test(project.link_url) ? 'GitHub ↗' : '项目链接 ↗'}
              </a>
            </div>
          )}

          {project.description && (
            <div
              className="markdown-body project-description"
              dangerouslySetInnerHTML={{ __html: renderMd(project.description) }}
            />
          )}

          <section className="project-blogs">
            <h3 className="project-blogs-title">相关博客</h3>
            {project.blogs && project.blogs.length === 0 ? (
              <div className="project-blogs-empty">该项目暂无关联博客</div>
            ) : (
              <div className="project-blogs-list">
                {project.blogs.map(blog => (
                  <Link key={blog.id} to={`/blogs/${blog.id}`} className="project-blog-item">
                    <span className="project-blog-title">{blog.title}</span>
                    {blog.category && <span className="project-blog-category">{blog.category}</span>}
                    <span className="project-blog-date">
                      {new Date(blog.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    <span className="project-blog-stats">
                      <UiIcon name="heart" size={13} /> {blog.like_count || 0} · <UiIcon name="message" size={13} /> {blog.comment_count || 0}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <div className="project-actions">
            <button
              className={`project-like-btn ${project.liked_by_me ? 'liked' : ''}`}
              onClick={handleProjectLike}
              disabled={projectLikePending}
            >
              <span><UiIcon name="heart" filled={project.liked_by_me} size={14} /></span>
              <span>{project.like_count || 0}</span>
            </button>
            {user && project && user.id !== project.author_id && (
              <button
                className={`project-follow-btn ${project.followed_by_me ? 'followed' : ''}`}
                onClick={handleProjectFollow}
                disabled={projectFollowPending}
              >
                {project.followed_by_me ? '已关注' : '关注'} {project.follow_count > 0 ? `(${project.follow_count})` : ''}
              </button>
            )}
          </div>

          {/* 评论区 */}
          <section className="project-comments comments-section">
            <h3 className="comments-title">
              评论 {projectComments.length > 0 && <span className="comments-count">({projectComments.length})</span>}
            </h3>

            {user ? (
              <form className="comment-form" onSubmit={handleProjPostComment}>
                <textarea
                  className="comment-input"
                  placeholder="写下你的评论..."
                  value={projCommentText}
                  onChange={e => setProjCommentText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
                {projCommentError && <div className="form-server-error">{projCommentError}</div>}
                <div className="comment-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={projCommentPosting}>
                    {projCommentPosting ? '发表中...' : '发表评论'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="comment-login-hint">
                <Link to="/auth">登录</Link> 后参与评论
              </div>
            )}

            <div className="comments-list">
              {projCommentsLoading ? (
                <div className="comments-empty">加载评论中...</div>
              ) : projTopLevel.length === 0 ? (
                <div className="comments-empty">还没有评论，来说点什么吧</div>
              ) : (
                projTopLevel.map(c => {
                  const descendants = collectDescendants(c)
                  return (
                    <div className="comment-thread" key={c.id}>
                      <ProjectCommentItem
                        c={c}
                        user={user}
                        showReplyBox={projReplyToId === c.id}
                        handleLike={handleProjCommentLike}
                        likePending={projCommentLikePending}
                        onOpenReply={handleProjOpenReply}
                        onCancelReply={handleProjCancelReply}
                        onPostReply={handleProjPostReply}
                        replyText={projReplyText}
                        setReplyText={setProjReplyText}
                        replyPosting={projReplyPosting}
                        replyError={projReplyError}
                        onDelete={setProjCommentToDelete}
                      />
                      {descendants.length > 0 && (
                        <div className="comment-replies">
                          {descendants.map(r => (
                            <div className="comment-reply" key={r.id}>
                              <ProjectCommentItem
                                c={r}
                                user={user}
                                showReplyBox={projReplyToId === r.id}
                                handleLike={handleProjCommentLike}
                                likePending={projCommentLikePending}
                                onOpenReply={handleProjOpenReply}
                                onCancelReply={handleProjCancelReply}
                                onPostReply={handleProjPostReply}
                                replyText={projReplyText}
                                setReplyText={setProjReplyText}
                                replyPosting={projReplyPosting}
                                replyError={projReplyError}
                                onDelete={setProjCommentToDelete}
                              />
                            </div>
                          ))}
                        </div>
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
        message="确认删除这个项目？删除后无法恢复。"
        confirmText={deleting ? '删除中...' : '确认删除'}
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
      <Modal
        open={!!projCommentToDelete}
        title="删除评论"
        message="确认删除这条评论？删除后无法恢复。"
        confirmText="确认删除"
        danger
        onConfirm={handleProjDeleteComment}
        onCancel={() => setProjCommentToDelete(null)}
      />
    </div>
  )
}

export default ProjectDetailPage
