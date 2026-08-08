import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import NavItem from './NavItem'

function Navbar({ activePage }) {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [unread, setUnread] = useState(0)
  const [badgeOn, setBadgeOn] = useState(localStorage.getItem('notify_badge_enabled') !== '0')

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
    const sync = () => {
      const raw = localStorage.getItem('user')
      if (raw) {
        try { setUser(JSON.parse(raw)) } catch { setUser(null) }
      } else { setUser(null) }
    }
    const syncBadge = (e) => {
      if (e.key === 'notify_badge_enabled') {
        setBadgeOn(e.newValue !== '0')
      }
    }
    window.addEventListener('storage', sync)
    window.addEventListener('storage', syncBadge)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('storage', syncBadge)
    }
  }, [])

  // 校验当前登录用户的账户是否仍在数据库中存在
  // 若后端返回 401/404（账户已被删除），则清除本地登录态并刷新
  useEffect(() => {
    const token = localStorage.getItem('token')
    const storedUser = localStorage.getItem('user')
    if (!token || !storedUser) return
    let cancelled = false
    fetch('/api/user/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (cancelled) return null
        if (r.status === 401 || r.status === 404) {
          // 账户不存在或令牌无效 —— 退出登录
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          setUser(null)
          // 触发 storage 事件以同步其他组件
          window.dispatchEvent(new StorageEvent('storage', { key: 'user' }))
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (cancelled || !data) return
        // 同步最新用户信息
        localStorage.setItem('user', JSON.stringify(data))
        setUser(data)
      })
      .catch(() => {
        // 网络错误时静默处理，不打扰用户
      })
    return () => { cancelled = true }
  }, [])

  // 拉取未读通知数，登录时在「我的」栏目显示徽标（路由变化重新挂载即自动刷新）
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!user || !token) {
      setUnread(0)
      return
    }
    let cancelled = false
    fetch('/api/notifications', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data) return
        setUnread(data.unread_count || 0)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user])

  const scrollToSection = (id) => {
    if (window.location.pathname !== '/') {
      navigate('/')
      setTimeout(() => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    } else {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const getInitial = (name) => (name ? name.charAt(0).toUpperCase() : '?')

  return (
    <nav className="navbar">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <img src="/favicon.svg" alt="anticraft" className="logo-icon" />
          <span className="logo-text">anticraft</span>
        </Link>
        <div className="nav-right">
          <div className="nav-links">
            <NavItem label="博客" to="/blogs" active={activePage === 'blog'}>
              <Link to="/blogs">全部</Link>
              <Link to="/blogs?category=技术讨论">技术讨论</Link>
              <Link to="/blogs?category=更新日志">更新日志</Link>
              <Link to="/blogs?category=娱乐论坛">娱乐论坛</Link>
            </NavItem>
            <NavItem label="项目" to="/projects" active={activePage === 'project'} />
            {user && (
              <NavItem
                label={<span>我的{unread > 0 && badgeOn && <span className="nav-badge">{unread}</span>}</span>}
                to="/my"
                active={activePage === 'my'}
              />
            )}
            <NavItem label="首页" to="/" active={activePage === 'home'}>
              <Link to="/" onClick={() => setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50)}>开始</Link>
              <Link to="/" onClick={() => scrollToSection('projects')}>项目</Link>
              <Link to="/" onClick={() => scrollToSection('contact')}>联系</Link>
            </NavItem>
          </div>
          {user ? (
            <div className="nav-user">
              <Link to="/profile" className="nav-user-avatar" title="编辑资料">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="nav-avatar-img" />
                ) : (
                  <span className="nav-avatar-letter">
                    {getInitial(user.nickname || user.username)}
                  </span>
                )}
              </Link>
            </div>
          ) : (
            <Link to="/login" className="nav-login-btn">登录</Link>
          )}
        </div>
      </div>
    </nav>
  )
}

export default Navbar
