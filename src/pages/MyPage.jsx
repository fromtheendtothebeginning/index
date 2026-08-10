import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import './MyPage.css'

const TYPE_META = {
  comment_reply: { icon: '💬', label: '回复' },
  comment_like: { icon: '♥', label: '点赞' },
  blog_comment_like: { icon: '👍', label: '评论获赞' },
  project_new_blog: { icon: '📌', label: '项目新博客' },
  blog_like: { icon: '♥', label: '博客点赞' },
  blog_new_comment: { icon: '💬', label: '博客新评论' },
}

function MyPage() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [badgeOn, setBadgeOn] = useState(localStorage.getItem('notify_badge_enabled') !== '0')

  const handleToggleBadge = () => {
    const next = !badgeOn
    localStorage.setItem('notify_badge_enabled', next ? '1' : '0')
    window.dispatchEvent(new StorageEvent('storage', { key: 'notify_badge_enabled' }))
    setBadgeOn(next)
  }

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  })

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/auth')
      return
    }
    let cancelled = false
    setLoading(true)
    fetch('/api/notifications', { headers: authHeaders() })
      .then(r => {
        if (r.status === 401) {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          navigate('/auth')
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (cancelled || !data) return
        setNotifications(data.notifications || [])
        setUnread(data.unread_count || 0)
      })
      .catch(() => setError('网络错误'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [navigate])

  const handleReadAll = async () => {
    try {
      await fetch('/api/notifications/read', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setNotifications(ns => ns.map(n => ({ ...n, is_read: true })))
      setUnread(0)
    } catch { /* 网络错误静默处理 */ }
  }

  const handleClick = (n) => {
    if (!n.blog_id) return
    if (!n.is_read) {
      fetch('/api/notifications/read', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => {})
      setNotifications(ns => ns.map(x => (x.id === n.id ? { ...x, is_read: true } : x)))
      setUnread(u => Math.max(0, u - 1))
    }
    navigate(`/blogs/${n.blog_id}`)
  }

  const formatTime = (s) => (s ? new Date(s).toLocaleString('zh-CN') : '')

  return (
    <div className="my-page">
      <Navbar activePage="my" />
      <div className="my-container">
        <div className="my-header">
          <h1 className="my-title">我的通知</h1>
          <label className="my-badge-toggle">
            <input type="checkbox" checked={badgeOn} onChange={handleToggleBadge} />
            <span>未读红点</span>
          </label>
          {unread > 0 && <span className="my-unread-count">{unread} 条未读</span>}
          <button className="btn btn-sm my-read-all" onClick={handleReadAll}>全部已读</button>
        </div>
        {error && <div className="my-error">{error}</div>}
        {loading ? (
          <div className="my-loading">加载中...</div>
        ) : notifications.length === 0 ? (
          <div className="my-empty">暂无通知</div>
        ) : (
          <ul className="my-list">
            {notifications.map((n, i) => {
              const meta = TYPE_META[n.type] || { icon: '•', label: n.type }
              return (
                <li
                  key={n.id}
                  className={`my-item ${n.is_read ? '' : 'my-item-unread'} ${n.blog_id ? 'my-item-link' : ''}`}
                  onClick={() => handleClick(n)}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="my-item-icon" title={meta.label}>{meta.icon}</span>
                  <div className="my-item-main">
                    <p className="my-item-content">{n.content}</p>
                    <p className="my-item-meta">
                      {n.actor_username && <span className="my-item-actor">{n.actor_username}</span>}
                      <span className="my-item-time">{formatTime(n.created_at)}</span>
                    </p>
                  </div>
                  {!n.is_read && <span className="my-item-dot" />}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default MyPage
