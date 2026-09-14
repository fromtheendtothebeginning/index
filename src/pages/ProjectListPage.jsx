import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import ProjectCover from '../components/ProjectCover'
import Reveal from '../components/Reveal'
import { t } from '../i18n'
import './Project.css'

const API_BASE = '/api'

function ProjectListPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/projects`)
      .then(r => r.json())
      .then(data => setProjects(data.projects || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="project-page">
      <Navbar activePage="project" />

      <div className="project-main">
        <Reveal className="section-head">
          <div className="section-head-meta">
            <span className="folio">01</span>
            <span className="label">Projects</span>
          </div>
          <h1 className="section-title">{t('projectList.title')}</h1>
          <p className="section-desc">{t('projectList.subtitle')}</p>
        </Reveal>

        {user && user.role === 'admin' && (
          <div className="project-toolbar">
            <Link to="/projects/new" className="btn btn-primary">{t('projectList.new')}</Link>
          </div>
        )}

        {loading ? (
          <div className="project-loading">{t('projectList.loading')}</div>
        ) : projects.length === 0 ? (
          <div className="project-empty">
            <p>{t('projectList.empty')}</p>
            {user && user.role === 'admin' && <Link to="/projects/new" className="btn btn-primary">{t('projectList.createFirst')}</Link>}
          </div>
        ) : (
          <div className="project-grid">
            {projects.map(project => (
              <Reveal as={Link} key={project.id} to={`/projects/${project.id}`} className="project-card">
                <div className="project-card-media">
                  {project.cover_url ? (
                    <ProjectCover src={project.cover_url} alt={project.name} className="project-cover" bgColor={project.bg_color} />
                  ) : (
                    <div className="project-cover project-cover-placeholder">
                      {project.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="project-card-content">
                  <h3>{project.name}</h3>
                  {project.description && (
                    <p className="project-card-desc">{project.description}</p>
                  )}
                  <div className="project-meta">
                    <span className="label">
                      {project.author?.nickname || project.author?.username || t('projectList.anonymous')}
                    </span>
                    <span className="label">
                      {new Date(project.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    <span className="label project-meta-end">{t('projectList.blogCount', { count: project.blog_count || 0 })}</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ProjectListPage
