import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className={`app ${mounted ? 'mounted' : ''}`}>
      {/* 背景装饰 */}
      <div className="bg-grid" />
      <div className="bg-glow glow-1" />
      <div className="bg-glow glow-2" />
      <div className="bg-glow glow-3" />

      {/* 导航 */}
      <nav className="navbar">
        <div className="nav-inner">
          <a href="/" className="nav-logo">
            <span className="logo-icon">A</span>
            <span className="logo-text">anticraft</span>
          </a>
          <div className="nav-links">
            <a href="#about">关于</a>
            <a href="#projects">项目</a>
            <a href="#contact">联系</a>
          </div>
        </div>
      </nav>

      {/* Hero 区域 */}
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

      {/* 关于 */}
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

      {/* 项目 */}
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

      {/* 联系 */}
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

      {/* 底部 */}
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

export default App
