import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import { renderMd } from '../utils/markdown'
import './Project.css'

function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [user, setUser] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem('user')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { setUser(null) }
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    const token = localStorage.getItem('token')
    fetch(`/api/projects/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error('项目不存在')
        return r.json()
      })
      .then(data => setProject(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    const token = localStorage.getItem('token')
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '删除失败')
        return
      }
      navigate('/projects')
    } catch {
      alert('网络错误')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="project-page">
        <div className="project-main"><div className="blog-loading">加载中...</div></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="project-page">
        <div className="project-main">
          <div className="blog-error">
            <h2>{error}</h2>
            <Link to="/projects" className="btn btn-primary">&larr; 返回项目列表</Link>
          </div>
        </div>
      </div>
    )
  }

  const isAuthor = user && user.id === project.author_id
  const isAdmin = user && user.role === 'admin'

  return (
    <div className="project-page">
      <Navbar activePage="project" />

      <div className="project-main">
        <div className="project-detail">
          <div className="blog-detail-nav">
            <Link to="/projects" className="blog-back-link">&larr; 返回项目列表</Link>
          </div>

          {project.cover_url ? (
            <img src={project.cover_url} alt={project.name} className="project-detail-cover" />
          ) : (
            <div className="project-detail-cover project-cover-placeholder">
              {project.name.charAt(0)}
            </div>
          )}

          <h1 className="project-detail-title">{project.name}</h1>
          {project.tags && project.tags.length > 0 && (
            <div className="project-detail-tags">
              {project.tags.map(t => <span key={t} className="tag">{t}</span>)}
            </div>
          )}
          <div className="blog-detail-meta">
            <span className="blog-detail-author">
              作者：{project.author?.nickname || project.author?.username || '匿名'}
            </span>
            <span className="blog-detail-date">
              {new Date(project.created_at).toLocaleDateString('zh-CN', {
                year: 'numeric', month: 'long', day: 'numeric'
              })}
            </span>
          </div>

          {(isAuthor || isAdmin) && (
            <div className="project-actions">
              <Link to={`/projects/${project.id}/edit`} className="btn-edit">编辑</Link>
              <button className="btn-delete" onClick={() => setShowDeleteModal(true)} disabled={deleting}>
                {deleting ? '删除中...' : '删除'}
              </button>
            </div>
          )}

          {project.description && (
            <div
              className="markdown-body project-description"
              dangerouslySetInnerHTML={{ __html: renderMd(project.description) }}
            />
          )}

          <section className="project-blogs">
            <h3 className="project-blogs-title">相关博客</h3>
            {project.blogs && project.blogs.length === 0 ? (
              <div className="project-blogs-empty">该项目暂无关联博客</div>
            ) : (
              <div className="project-blogs-list">
                {project.blogs.map(blog => (
                  <Link key={blog.id} to={`/blogs/${blog.id}`} className="project-blog-item">
                    <span className="project-blog-title">{blog.title}</span>
                    {blog.category && <span className="project-blog-category">{blog.category}</span>}
                    <span className="project-blog-date">
                      {new Date(blog.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    <span className="project-blog-stats">
                      ♥ {blog.like_count || 0} · 💬 {blog.comment_count || 0}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={showDeleteModal}
        title="确认删除"
        message="确认删除这个项目？删除后无法恢复。"
        confirmText={deleting ? '删除中...' : '确认删除'}
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  )
}

export default ProjectDetailPage
