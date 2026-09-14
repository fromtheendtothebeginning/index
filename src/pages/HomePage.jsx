import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { renderMd, sanitizeUrl } from '../utils/markdown'
import ProjectCover from '../components/ProjectCover'
import Reveal from '../components/Reveal'
import { ContactIcon } from '../components/Icons'
import { t } from '../i18n'

export default function HomePage() {
  const [mounted, setMounted] = useState(false)
  const [recentProjects, setRecentProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [friendLinks, setFriendLinks] = useState([])
  const [contactSettings, setContactSettings] = useState({
    contact_items: [
      { label: '邮箱', value: 'jianghuxingxzhe@icloud.com', type: 'link', icon: 'email' },
      { label: 'GitHub', value: 'https://github.com/fromtheendtothebeginning', type: 'link', icon: 'github' },
    ],
  })

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

  useEffect(() => {
    fetch('/api/site-settings')
      .then(r => r.json())
      .then(d => d && setContactSettings({ ...contactSettings, ...d }))
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

  const visibleLinks = friendLinks.filter(f => sanitizeUrl(f.url))
  // 页码：友情链接区不渲染时，后续区块编号顺延
  const folioFriends = visibleLinks.length > 0 ? '02' : null
  const folioContact = visibleLinks.length > 0 ? '03' : '02'

  // 联系方式：区分邮箱（mailto）与普通链接，不可链接的仅作文本展示
  const contactItems = (contactSettings.contact_items || []).map((item, i) => {
    const isMail = /^mailto:/i.test(item.value) || (item.value.includes('@') && !/^https?:/i.test(item.value))
    const linkable = item.type === 'link' && (isMail || sanitizeUrl(item.value) !== null)
    return {
      key: i,
      label: item.label,
      description: item.description,
      icon: item.icon,
      type: item.type,
      href: linkable ? (isMail ? `mailto:${item.value.replace(/^mailto:/i, '')}` : item.value) : null,
    }
  })

  return (
    <div className={`app ${mounted ? 'mounted' : ''}`}>
      <Navbar activePage="home" />

      <section className="hero">
        <div className="hero-inner">
          <h1 className="hero-title">
            <span className="title-en">anticraft</span>
            <span className="title-cn">逆匠</span>
          </h1>
          <p className="hero-lede">{t('home.footer.motto')}</p>
          <div className="hero-actions">
            <a href="#projects" className="btn btn-primary">
              {t('home.hero.explore')}
              <span className="btn-arrow" aria-hidden="true">→</span>
            </a>
          </div>
          <div className="hero-meta">
            <span className="label">EST. 2026</span>
            <a href="#contact" className="label link-underline">Contact</a>
            <span className="hero-scroll">{t('home.hero.scroll')}</span>
          </div>
        </div>
      </section>

      <section id="projects" className="section">
        <div className="section-inner">
          <Reveal className="section-head">
            <div className="section-head-meta">
              <span className="folio">01</span>
              <span className="label">Projects</span>
            </div>
            <h2 className="section-title">{t('home.projects.title')}</h2>
            <p className="section-desc">{t('home.projects.desc')}</p>
          </Reveal>
          <div className="project-grid">
            {projectsLoading || recentProjects.length === 0 ? (
              <Reveal className="project-card">
                <div className="project-card-media">
                  <div className="project-card-bg" />
                </div>
                <div className="project-card-content">
                  <h3>{projectsLoading ? t('home.projects.loading') : t('home.projects.emptyTitle')}</h3>
                  {!projectsLoading && <p>{t('home.projects.emptyDesc')}</p>}
                </div>
              </Reveal>
            ) : (
              recentProjects.map(p => (
                <Reveal as={Link} to={`/projects/${p.id}`} key={p.id} className="project-card">
                  <div className="project-card-media">
                    {p.cover_url ? (
                      <ProjectCover src={p.cover_url} alt={p.name} className="project-cover" bgColor={p.bg_color} />
                    ) : (
                      <div className="project-card-bg" />
                    )}
                  </div>
                  <div className="project-card-content">
                    {p.tags && p.tags.length > 0 && (
                      <div className="project-tags">
                        {p.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
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

      {visibleLinks.length > 0 && (
        <section id="friends" className="section">
          <div className="section-inner">
            <Reveal className="section-head">
              <div className="section-head-meta">
                <span className="folio">{folioFriends}</span>
                <span className="label">Links</span>
              </div>
              <h2 className="section-title">{t('home.friends.title')}</h2>
              <p className="section-desc">{t('home.friends.desc')}</p>
            </Reveal>
            <Reveal className="friend-links-grid">
              {visibleLinks.map(f => (
                <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="friend-link-card">
                  <span className="friend-link-name">{f.name}</span>
                  {f.description && <span className="friend-link-desc">{f.description}</span>}
                </a>
              ))}
            </Reveal>
          </div>
        </section>
      )}

      <section id="contact" className="section">
        <div className="section-inner">
          <Reveal className="section-head">
            <div className="section-head-meta">
              <span className="folio">{folioContact}</span>
              <span className="label">Contact</span>
            </div>
            <h2 className="section-title">{t('home.contact.title')}</h2>
            <p className="section-desc">{t('home.contact.desc')}</p>
          </Reveal>
          <Reveal className="contact-links">
            {contactItems.map(item => {
              const inner = (
                <>
                  <span className="contact-icon"><ContactIcon icon={item.icon} type={item.type} /></span>
                  <div>
                    <span className="contact-label">{item.label}</span>
                    {item.description && <span className="contact-desc">{item.description}</span>}
                  </div>
                </>
              )
              return item.href ? (
                <a key={item.key} href={item.href} target="_blank" rel="noopener noreferrer" className="contact-item">
                  {inner}
                </a>
              ) : (
                <div key={item.key} className="contact-item contact-item-text">{inner}</div>
              )
            })}
          </Reveal>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <span className="footer-logo">anticraft · 逆匠</span>
              <span className="footer-tagline">{t('home.footer.motto')}</span>
            </div>
            <div className="footer-col">
              <span className="footer-col-title">Index</span>
              <Link to="/" className="link-underline">首页</Link>
              <Link to="/blogs" className="link-underline">{t('nav.blog')}</Link>
              <Link to="/projects" className="link-underline">{t('nav.project')}</Link>
              <Link to="/tools" className="link-underline">{t('nav.tools')}</Link>
            </div>
            <div className="footer-col">
              <span className="footer-col-title">Contact</span>
              {contactItems.map(item => (
                item.href ? (
                  <a key={item.key} href={item.href} target="_blank" rel="noopener noreferrer" className="link-underline">
                    {item.label}
                  </a>
                ) : (
                  <span key={item.key}>{item.label}</span>
                )
              ))}
            </div>
          </div>
          <div className="footer-inner">
            <p className="footer-copyright">
              © {new Date().getFullYear()} <strong>anticraft</strong> · 逆匠
            </p>
            <span className="footer-motto">{t('home.footer.motto')}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
