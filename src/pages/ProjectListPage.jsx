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
        <Reveal className="project-header">
          <div className="project-header-content">
            <h1 className="project-title">{t('projectList.title')}</h1>
            <p className="project-subtitle">{t('projectList.subtitle')}</p>
          </div>
          {user && user.role === 'admin' && (
            <Link to="/projects/new" className="btn btn-primary">{t('projectList.new')}</Link>
          )}
        </Reveal>

        {loading ? (
          <div className="blog-loading">{t('projectList.loading')}</div>
        ) : projects.length === 0 ? (
          <div className="blog-empty">
            <p>{t('projectList.empty')}</p>
            {user && user.role === 'admin' && <Link to="/projects/new" className="btn btn-primary">{t('projectList.createFirst')}</Link>}
          </div>
        ) : (
          <div className="project-grid">
            {projects.map(project => (
              <Reveal as={Link} key={project.id} to={`/projects/${project.id}`} className="project-card">
                {project.cover_url ? (
                  <ProjectCover src={project.cover_url} alt={project.name} className="project-cover" bgColor={project.bg_color} />
                ) : (
                  <div className="project-cover project-cover-placeholder">
                    {project.name.charAt(0)}
                  </div>
                )}
                <div className="project-card-body">
                  <h2 className="project-card-name">{project.name}</h2>
                  {project.description && (
                    <p className="project-card-desc">{project.description}</p>
                  )}
                  <div className="project-card-meta">
                    <span className="project-card-author">
                      {project.author?.nickname || project.author?.username || t('projectList.anonymous')}
                    </span>
                    <span className="project-card-date">
                      {new Date(project.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    <span className="project-card-blogs">{t('projectList.blogCount', { count: project.blog_count || 0 })}</span>
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
