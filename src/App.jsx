import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Navbar from './components/Navbar'
import AuthPage from './pages/AuthPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import BlogListPage from './pages/BlogListPage'
import BlogDetailPage from './pages/BlogDetailPage'
import BlogEditorPage from './pages/BlogEditorPage'
import ProjectListPage from './pages/ProjectListPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectEditorPage from './pages/ProjectEditorPage'
import ProfileEdit from './pages/ProfileEdit'
import AdminPage from './pages/AdminPage'
import { renderMd } from './utils/markdown'
import ProjectCover from './components/ProjectCover'
import Reveal from './components/Reveal'
import './App.css'

function HomePage() {
  const [mounted, setMounted] = useState(false)
  const [recentProjects, setRecentProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [friendLinks, setFriendLinks] = useState([])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => setRecentProjects((d.projects || []).slice(0, 3)))
      .finally(() => setProjectsLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/friend-links')
      .then(r => r.json())
      .then(d => setFriendLinks(d.links || []))
      .catch(() => {})
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
          <Reveal className="section-header">
            <span className="section-tag">PROJECTS</span>
            <h2 className="section-title">近期项目</h2>
            <p className="section-desc">每一个项目都是一次对边界的试探。</p>
          </Reveal>
          <div className="project-grid">
            {projectsLoading ? (
              <Reveal className="project-card">
                <div className="project-card-bg" />
                <div className="project-card-content">
                  <p>加载中...</p>
                </div>
              </Reveal>
            ) : recentProjects.length === 0 ? (
              <Reveal className="project-card">
                <div className="project-card-bg" />
                <div className="project-card-content">
                  <h3>暂无项目</h3>
                  <p>敬请期待</p>
                </div>
              </Reveal>
            ) : (
              recentProjects.map(p => (
                <Reveal as={Link} to={`/projects/${p.id}`} key={p.id} className="project-card">
                  {p.cover_url ? (
                    <ProjectCover src={p.cover_url} alt={p.name} className="project-cover" bgColor={p.bg_color} />
                  ) : (
                    <div className="project-card-bg" />
                  )}
                  <div className="project-card-content">
                    {p.tags && p.tags.length > 0 && (
                      <div className="project-tags">
                        {p.tags.map(t => <span key={t} className="tag">{t}</span>)}
                      </div>
                    )}
                    <h3>{p.name}</h3>
                    <div
                      className="markdown-body project-card-desc"
                      dangerouslySetInnerHTML={{ __html: renderMd(p.description || '') }}
                    />
                  </div>
                </Reveal>
              ))
            )}
          </div>
        </div>
      </section>

      {friendLinks.length > 0 && (
        <section id="friends" className="section friends-section">
          <div className="section-inner">
            <Reveal className="section-header">
              <span className="section-tag">LINKS</span>
              <h2 className="section-title">友情链接</h2>
              <p className="section-desc">值得推荐的伙伴站点</p>
            </Reveal>
            <Reveal className="friend-links-grid">
              {friendLinks.map(f => (
                <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="friend-link-card">
                  <span className="friend-link-name">{f.name}</span>
                  {f.description && <span className="friend-link-desc">{f.description}</span>}
                </a>
              ))}
            </Reveal>
          </div>
        </section>
      )}

      <section id="contact" className="section contact-section">
        <div className="section-inner">
          <Reveal className="section-header">
            <span className="section-tag">CONTACT</span>
            <h2 className="section-title">保持连接</h2>
            <p className="section-desc">无论你是想合作、交流想法，还是单纯打个招呼——我们都在。</p>
          </Reveal>
          <Reveal className="contact-links">
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
          </Reveal>
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
      <Route path="/login" element={<Navigate to="/auth" replace />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/blogs" element={<BlogListPage />} />
      <Route path="/blogs/new" element={<BlogEditorPage />} />
      <Route path="/blogs/:id" element={<BlogDetailPage />} />
      <Route path="/blogs/:id/edit" element={<BlogEditorPage />} />
      <Route path="/projects" element={<ProjectListPage />} />
      <Route path="/projects/new" element={<ProjectEditorPage />} />
      <Route path="/projects/:id" element={<ProjectDetailPage />} />
      <Route path="/projects/:id/edit" element={<ProjectEditorPage />} />
      <Route path="/profile" element={<ProfileEdit />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  )
}

export default App
