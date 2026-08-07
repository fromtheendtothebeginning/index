import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import './Project.css'

function ProjectEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [name, setName] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [allBlogs, setAllBlogs] = useState([])
  const [selectedBlogIds, setSelectedBlogIds] = useState([])
  const [blogsLoading, setBlogsLoading] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) navigate('/auth')
  }, [navigate])

  useEffect(() => {
    if (!isEdit) return
    fetch(`/api/projects/${id}`)
      .then(r => r.json())
      .then(data => {
        setName(data.name)
        setCoverUrl(data.cover_url || '')
        setDescription(data.description || '')
        setTags((data.tags || []).join(', '))
        setSelectedBlogIds((data.blogs || []).map(b => b.id))
      })
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false))

    setBlogsLoading(true)
    fetch('/api/blogs?skip=0&limit=500')
      .then(r => r.json())
      .then(data => setAllBlogs(data.blogs || []))
      .catch(() => setAllBlogs([]))
      .finally(() => setBlogsLoading(false))
  }, [id, isEdit])

  const toggleBlog = (blogId) => {
    setSelectedBlogIds(prev =>
      prev.includes(blogId) ? prev.filter(x => x !== blogId) : [...prev, blogId]
    )
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('请输入项目名'); return }
    const token = localStorage.getItem('token')
    setSaving(true)
    setError('')

    try {
      const url = isEdit ? `/api/projects/${id}` : '/api/projects'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description || null,
          cover_url: coverUrl || null,
          tags: tags.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || '保存失败'); return }
      if (isEdit) {
        try {
          await fetch(`/api/projects/${id}/blogs`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ blog_ids: selectedBlogIds }),
          })
        } catch {
          // 关联博客保存失败不阻断跳转
        }
      }
      navigate(`/projects/${data.id}`)
    } catch {
      setError('网络错误')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="project-page">
        <div className="project-main"><div className="blog-loading">加载中...</div></div>
      </div>
    )
  }

  return (
    <div className="project-page">
      <Navbar activePage="project" />

      <div className="project-main">
        <div className="project-editor">
          <div className="editor-header">
            <Link to={isEdit ? `/projects/${id}` : '/projects'} className="blog-back-link">&larr; 返回项目</Link>
          </div>
          <h1 className="editor-title">{isEdit ? '编辑项目' : '新建项目'}</h1>

          {error && <div className="form-server-error">{error}</div>}

          <div className="editor-field">
            <label className="editor-label">项目名</label>
            <input
              type="text"
              className="editor-title-input"
              placeholder="输入项目名称..."
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="editor-field">
            <label className="editor-label">封面链接</label>
            <input
              type="text"
              className="editor-title-input"
              placeholder="输入图床封面 URL"
              value={coverUrl}
              onChange={e => setCoverUrl(e.target.value)}
            />
            <div className="cover-preview">
              {coverUrl ? (
                <img src={coverUrl} alt="封面预览" className="cover-preview-img" />
              ) : (
                <span className="cover-preview-placeholder">暂无封面预览</span>
              )}
            </div>
          </div>

          <div className="editor-field">
            <label className="editor-label">项目简介</label>
            <textarea
              className="project-desc-input"
              placeholder="使用 Markdown 语法写项目简介（可空）..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={8}
            />
          </div>

          <div className="editor-field">
            <label className="editor-label">标签</label>
            <input
              type="text"
              className="editor-title-input"
              placeholder="自定义标签，用逗号分隔，如 React, AI, 开源"
              value={tags}
              onChange={e => setTags(e.target.value)}
            />
          </div>

          {isEdit ? (
            <div className="editor-field">
              <div className="editor-label">关联博客</div>
              <p className="editor-hint">勾选要加入该项目的博客</p>
              {blogsLoading ? (
                <p className="editor-hint">加载中...</p>
              ) : allBlogs.length === 0 ? (
                <p className="editor-hint">还没有博客</p>
              ) : (
                <div className="project-blog-select">
                  {allBlogs.map(b => (
                    <div className="project-blog-row" key={b.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedBlogIds.includes(b.id)}
                          onChange={() => toggleBlog(b.id)}
                        />
                        {b.title}
                        {b.category && <span className="blog-card-category">{b.category}</span>}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="editor-field">
              <p className="editor-hint">保存项目后，可在编辑页关联博客</p>
            </div>
          )}

          <div className="editor-actions">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : (isEdit ? '保存修改' : '创建项目')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProjectEditorPage
