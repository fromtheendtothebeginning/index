import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import ProjectCover from '../components/ProjectCover'
import Reveal from '../components/Reveal'
import { t } from '../i18n'
import './Project.css'

function ProjectEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [name, setName] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [bgColor, setBgColor] = useState('')
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [allBlogs, setAllBlogs] = useState([])
  const [selectedBlogIds, setSelectedBlogIds] = useState([])
  const [blogsLoading, setBlogsLoading] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      navigate('/auth')
      return
    }
    const raw = localStorage.getItem('user')
    if (raw) {
      try {
        const u = JSON.parse(raw)
        if (u.role !== 'admin') {
          navigate('/projects')
          return
        }
      } catch {}
    }
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
        setBgColor(data.bg_color || '')
        setLinks(data.links && data.links.length
          ? data.links
          : (data.link_url ? [{ name: t('projectEditor.defaultLinkName'), url: data.link_url }] : []))
        setSelectedBlogIds((data.blogs || []).map(b => b.id))
      })
      .catch(() => setError(t('projectEditor.loadFailed')))
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

  const updateLink = (i, field, value) => {
    setLinks(prev => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  const addLink = () => setLinks(prev => [...prev, { name: '', url: '' }])

  const removeLink = (i) => {
    setLinks(prev => prev.filter((_, idx) => idx !== i))
  }

  const handleSave = async () => {
    if (!name.trim()) { setError(t('projectEditor.enterName')); return }
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
          bg_color: bgColor || null,
          links: links
            .map(l => ({ name: (l.name || '').trim() || t('projectEditor.link'), url: (l.url || '').trim() }))
            .filter(l => l.url),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || t('projectEditor.saveFailed')); return }
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
      setError(t('projectEditor.networkError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="project-page">
        <div className="project-main"><div className="project-loading">{t('projectEditor.loading')}</div></div>
      </div>
    )
  }

  return (
    <div className="project-page">
      <Navbar activePage="project" />

      <div className="project-main">
        <div className="project-editor">
          <Reveal className="editor-header">
            <Link to={isEdit ? `/projects/${id}` : '/projects'} className="project-back-link">&larr; {t('projectEditor.backProjects')}</Link>
          </Reveal>
          <Reveal as="h1" className="editor-title">{isEdit ? t('projectEditor.editTitle') : t('projectEditor.newTitle')}</Reveal>

          {error && <div className="form-server-error">{error}</div>}

          <div className="editor-field">
            <div className="field">
              <input
                id="project-name"
                type="text"
                placeholder=" "
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <label htmlFor="project-name">{t('projectEditor.name')}</label>
            </div>
          </div>

          <div className="editor-field">
            <div className="field">
              <input
                id="project-cover-url"
                type="text"
                placeholder=" "
                value={coverUrl}
                onChange={e => setCoverUrl(e.target.value)}
              />
              <label htmlFor="project-cover-url">{t('projectEditor.coverUrl')}</label>
            </div>
            <div className="cover-preview">
              {coverUrl ? (
                <ProjectCover src={coverUrl} alt={t('projectEditor.coverPreviewAlt')} className="cover-preview-img" bgColor={bgColor} />
              ) : (
                <span className="cover-preview-placeholder">{t('projectEditor.noCoverPreview')}</span>
              )}
            </div>
          </div>

          <div className="editor-field">
            <div className="field">
              <textarea
                id="project-description"
                placeholder=" "
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={8}
              />
              <label htmlFor="project-description">{t('projectEditor.description')}</label>
            </div>
          </div>

          <div className="editor-field">
            <div className="field">
              <input
                id="project-tags"
                type="text"
                placeholder=" "
                value={tags}
                onChange={e => setTags(e.target.value)}
              />
              <label htmlFor="project-tags">{t('projectEditor.tags')}</label>
            </div>
          </div>

          <div className="editor-field">
            <span className="label">{t('projectEditor.bgColor')}</span>
            <div className="editor-bg-color-row">
              <input
                type="color"
                className="editor-bg-color-input"
                value={bgColor || ''}
                onChange={e => setBgColor(e.target.value)}
              />
            </div>
          </div>

          <div className="editor-field">
            <span className="label">{t('projectEditor.links')}</span>
            <div className="project-links-editor">
              {links.map((l, i) => (
                <div className="project-link-row" key={i}>
                  <div className="field project-link-name">
                    <input
                      id={`project-link-name-${i}`}
                      type="text"
                      placeholder=" "
                      value={l.name}
                      onChange={e => updateLink(i, 'name', e.target.value)}
                    />
                    <label htmlFor={`project-link-name-${i}`}>{t('projectEditor.linkNamePlaceholder')}</label>
                  </div>
                  <div className="field project-link-url">
                    <input
                      id={`project-link-url-${i}`}
                      type="text"
                      placeholder=" "
                      value={l.url}
                      onChange={e => updateLink(i, 'url', e.target.value)}
                    />
                    <label htmlFor={`project-link-url-${i}`}>{t('projectEditor.link')}</label>
                  </div>
                  <button
                    type="button"
                    className="project-link-del"
                    onClick={() => removeLink(i)}
                    title={t('projectEditor.deleteLink')}
                  >×</button>
                </div>
              ))}
            </div>
            <button type="button" className="project-link-add" onClick={addLink}>+ {t('projectEditor.addLink')}</button>
          </div>

          {isEdit ? (
            <div className="editor-field">
              <span className="label">{t('projectEditor.linkBlogs')}</span>
              <p className="editor-hint">{t('projectEditor.linkBlogsHint')}</p>
              {blogsLoading ? (
                <p className="editor-hint">{t('projectEditor.loading')}</p>
              ) : allBlogs.length === 0 ? (
                <p className="editor-hint">{t('projectEditor.noBlogs')}</p>
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
                        {b.category && <span className="tag">{b.category}</span>}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="editor-field">
              <p className="editor-hint">{t('projectEditor.linkBlogsAfterSave')}</p>
            </div>
          )}

          <div className="editor-actions">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? t('projectEditor.saving') : (isEdit ? t('projectEditor.saveChanges') : t('projectEditor.create'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProjectEditorPage
