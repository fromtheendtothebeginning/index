import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'

function Navbar({ activePage }) {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)

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
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
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
            {/* 博客下拉 */}
            <div className="nav-dropdown">
              <Link
                to="/blogs"
                className={`nav-dropdown-trigger ${activePage === 'blog' ? 'nav-item-active' : ''}`}
              >
                博客<span className="arrow-down">▾</span>
              </Link>
              <div className="nav-dropdown-menu">
                <Link to="/blogs">全部</Link>
                <Link to="/blogs?category=技术讨论">技术讨论</Link>
                <Link to="/blogs?category=更新日志">更新日志</Link>
                <Link to="/blogs?category=娱乐论坛">娱乐论坛</Link>
              </div>
            </div>
            {/* 首页下拉 */}
            <div className="nav-dropdown">
              <Link
                to="/"
                className={`nav-dropdown-trigger ${activePage === 'home' ? 'nav-item-active' : ''}`}
              >
                首页<span className="arrow-down">▾</span>
              </Link>
              <div className="nav-dropdown-menu">
                <Link to="/" onClick={() => setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50)}>开始</Link>
                <Link to="/" onClick={() => scrollToSection('projects')}>项目</Link>
                <Link to="/" onClick={() => scrollToSection('contact')}>联系</Link>
              </div>
            </div>
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
