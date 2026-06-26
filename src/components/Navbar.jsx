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
