import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import AuthPage from './pages/AuthPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import BlogListPage from './pages/BlogListPage'
import BlogDetailPage from './pages/BlogDetailPage'
import BlogEditorPage from './pages/BlogEditorPage'
import ProfileEdit from './pages/ProfileEdit'
import './App.css'

function HomePage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // 从其他页面带 hash 跳转（如 /#projects）时滚动到对应模块
  useEffect(() => {
    if (window.location.hash) {
      const id = window.location.hash.slice(1)
      const el = document.getElementById(id)
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100)
      }
    }
  }, [mounted])

  // 滚动到视口时触发卡片滑入动画
  useEffect(() => {
    const els = document.querySelectorAll('.scroll-reveal')
    if (!els.length) return

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            obs.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )

    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [mounted])

  return (
    <div className={`app ${mounted ? 'mounted' : ''}`}>
      <div className="bg-grid" />
      <div className="bg-glow glow-1" />
      <div className="bg-glow glow-2" />
      <div className="bg-glow glow-3" />

      {/* 导航 */}
      <Navbar activePage="home" />

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
          <div className="hero-actions">
            <a href="#projects" className="btn btn-primary">
              探索项目
              <span className="btn-arrow">→</span>
            </a>
          </div>
        </div>
        <div className="hero-scroll">
          <div className="scroll-line" />
          <span className="scroll-text">滚动浏览</span>
        </div>
      </section>

      <section id="projects" className="section projects-section">
        <div className="section-inner">
          <div className="section-header scroll-reveal">
            <span className="section-tag">PROJECTS</span>
            <h2 className="section-title">近期项目</h2>
            <p className="section-desc">每一个项目都是一次对边界的试探。</p>
          </div>
          <div className="project-grid">
            <div className="project-card scroll-reveal">
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
            <div className="project-card scroll-reveal">
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
          <div className="section-header scroll-reveal">
            <span className="section-tag">CONTACT</span>
            <h2 className="section-title">保持连接</h2>
            <p className="section-desc">无论你是想合作、交流想法，还是单纯打个招呼——我们都在。</p>
          </div>
          <div className="contact-links scroll-reveal">
            <a href="mailto:jianghuxingxzhe@icloud.com" className="contact-item">
              <span className="contact-icon">✉</span>
              <div>
                <span className="contact-label">邮件</span>
                <span className="contact-value">jianghuxingxzhe@icloud.com</span>
              </div>
            </a>
            <a href="https://github.com/fromtheendtothebeginning" target="_blank" rel="noopener noreferrer" className="contact-item">
              <span className="contact-icon">⌘</span>
              <div>
                <span className="contact-label">GitHub</span>
                <span className="contact-value">@fromtheendtothebeginning</span>
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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/blogs" element={<BlogListPage />} />
      <Route path="/blogs/new" element={<BlogEditorPage />} />
      <Route path="/blogs/:id" element={<BlogDetailPage />} />
      <Route path="/blogs/:id/edit" element={<BlogEditorPage />} />
      <Route path="/profile" element={<ProfileEdit />} />
    </Routes>
  )
}

export default App
