import { useState, useEffect } from 'react'
import { Routes, Route, Link, useNavigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage'
import ProfileEdit from './pages/ProfileEdit'
import './App.css'

function NavbarUser() {
  const [user, setUser] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const sync = () => {
      const raw = localStorage.getItem('user')
      if (raw) {
        try { setUser(JSON.parse(raw)) } catch { setUser(null) }
      } else {
        setUser(null)
      }
    }
    sync()
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    navigate('/')
  }

  const getInitial = (name) => (name ? name.charAt(0).toUpperCase() : '?')

  if (user) {
    return (
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
        <span className="nav-user-name">{user.nickname || user.username}</span>
        <button className="nav-logout-btn" onClick={handleLogout}>退出</button>
      </div>
    )
  }

  return <Link to="/auth" className="nav-login-btn">登录</Link>
}

function HomePage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className={`app ${mounted ? 'mounted' : ''}`}>
      <div className="bg-grid" />
      <div className="bg-glow glow-1" />
      <div className="bg-glow glow-2" />
      <div className="bg-glow glow-3" />

      {/* 导航 */}
      <nav className="navbar">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            <span className="logo-icon">A</span>
            <span className="logo-text">anticraft</span>
          </Link>
          <div className="nav-right">
            <div className="nav-links">
              <a href="#about">关于</a>
              <a href="#projects">项目</a>
              <a href="#contact">联系</a>
            </div>
            <NavbarUser />
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="badge-dot" />
            EST. 2026
          </div>
          <h1 className="hero-title">
            <span className="title-en">anticraft</span>
            <span className="title-divider">·</span>
            <span className="title-cn">逆匠</span>
          </h1>
          <p className="hero-subtitle">
            以匠心为刃，破常规之笼。<br />
            <span className="subtitle-extra">在秩序中寻找裂痕，在裂痕中创造可能。</span>
          </p>
          <div className="hero-actions">
            <a href="#projects" className="btn btn-primary">
              探索项目
              <span className="btn-arrow">→</span>
            </a>
            <a href="#about" className="btn btn-secondary">
              了解更多
            </a>
          </div>
        </div>
        <div className="hero-scroll">
          <div className="scroll-line" />
          <span className="scroll-text">滚动浏览</span>
        </div>
      </section>

      <section id="about" className="section about-section">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-tag">ABOUT</span>
            <h2 className="section-title">逆匠之道</h2>
            <p className="section-desc">
              「逆匠」并非反对匠心，而是拒绝被定义的匠心。
              我们相信真正的创造始于对既有规则的审视与超越。
            </p>
          </div>
          <div className="about-cards">
            <div className="about-card" style={{ '--delay': '0ms' }}>
              <div className="card-icon">⚡</div>
              <h3>破格</h3>
              <p>跳出框架重新审视问题，在常规路径之外找到最优解。</p>
            </div>
            <div className="about-card" style={{ '--delay': '150ms' }}>
              <div className="card-icon">🔨</div>
              <h3>淬炼</h3>
              <p>每一次打磨都是对完美的逼近，细节中见真章。</p>
            </div>
            <div className="about-card" style={{ '--delay': '300ms' }}>
              <div className="card-icon">🌌</div>
              <h3>创造</h3>
              <p>从零到一构建前所未有之物，让想法落地成真。</p>
            </div>
          </div>
        </div>
      </section>

      <section id="projects" className="section projects-section">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-tag">PROJECTS</span>
            <h2 className="section-title">近期项目</h2>
            <p className="section-desc">每一个项目都是一次对边界的试探。</p>
          </div>
          <div className="project-grid">
            <div className="project-card">
              <div className="project-card-bg" />
              <div className="project-card-content">
                <div className="project-tags">
                  <span className="tag">React</span>
                  <span className="tag">Vite</span>
                </div>
                <h3>逆匠首页</h3>
                <p>极简风格的全新品牌落地页，承载逆匠的设计哲学。</p>
                <div className="project-meta">
                  <span className="meta-status active">进行中</span>
                </div>
              </div>
            </div>
            <div className="project-card">
              <div className="project-card-bg" />
              <div className="project-card-content">
                <div className="project-tags">
                  <span className="tag">即将发布</span>
                </div>
                <h3>更多项目</h3>
                <p>正在酝酿中的新项目，敬请期待。</p>
                <div className="project-meta">
                  <span className="meta-status pending">筹备中</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="section contact-section">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-tag">CONTACT</span>
            <h2 className="section-title">保持连接</h2>
            <p className="section-desc">无论你是想合作、交流想法，还是单纯打个招呼——我们都在。</p>
          </div>
          <div className="contact-links">
            <a href="mailto:hello@anticraft.dev" className="contact-item">
              <span className="contact-icon">✉</span>
              <div>
                <span className="contact-label">邮件</span>
                <span className="contact-value">hello@anticraft.dev</span>
              </div>
            </a>
            <a href="https://github.com/anticraft" target="_blank" rel="noopener noreferrer" className="contact-item">
              <span className="contact-icon">⌘</span>
              <div>
                <span className="contact-label">GitHub</span>
                <span className="contact-value">@anticraft</span>
              </div>
            </a>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <p className="footer-copyright">
            © {new Date().getFullYear()} <strong>anticraft</strong> · 逆匠
          </p>
          <p className="footer-motto">以匠心破常规</p>
        </div>
      </footer>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/profile" element={<ProfileEdit />} />
    </Routes>
  )
}

export default App
