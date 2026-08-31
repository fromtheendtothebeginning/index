import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Modal from '../../components/Modal'
import { UiIcon } from '../../components/Icons'
import { t } from '../../i18n'
import '../../pages/ToolParsePage.css'
import './Img2LatexPage.css'

function Img2LatexPage() {
  const token = localStorage.getItem('token')
  const [images, setImages] = useState([])          // [{ file, url }]
  const [notes, setNotes] = useState('')
  const [code, setCode] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [engine, setEngine] = useState(true)
  const [error, setError] = useState('')
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef(null)
  const pdfBlobRef = useRef(null)

  useEffect(() => {
    if (!token) return
    fetch('/api/tools/img2latex/available', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setEngine(!!d.engine))
      .catch(() => {})
    return () => {
      if (pdfBlobRef.current) URL.revokeObjectURL(pdfBlobRef.current)
    }
  }, [])

  function addImages(files) {
    const next = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      next.push({ file: f, url: URL.createObjectURL(f) })
    }
    setImages(prev => [...prev, ...next].slice(0, 4))
  }

  function removeImage(i) {
    setImages(prev => {
      URL.revokeObjectURL(prev[i].url)
      return prev.filter((_, idx) => idx !== i)
    })
  }

  function gotoAiSettings() {
    sessionStorage.setItem('profile_redirect', '/tools/img2latex')
    window.location.href = '/profile'
  }

  async function handleGenerate() {
    if (genLoading) return
    if (images.length === 0) { setError(t('img2latex.err.noImage')); return }
    setGenLoading(true)
    setError('')
    setPdfUrl(null)
    try {
      const fd = new FormData()
      images.forEach(it => fd.append('images', it.file))
      fd.append('notes', notes)
      const res = await fetch('/api/tools/img2latex/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (e_isAiConfig(data)) { setShowConfigModal(true); return }
      if (!res.ok) throw new Error(typeof data.detail === 'object' ? data.detail.message : (data.detail || t('img2latex.err.generate')))
      setCode(data.code || '')
    } catch (e) {
      setError(e.message || t('img2latex.err.generate'))
    } finally {
      setGenLoading(false)
    }
  }

  function e_isAiConfig(data) {
    return data && typeof data.detail === 'object' && data.detail.code === 'ai_config'
  }

  async function handleCompile() {
    if (compiling || !code.trim()) return
    setCompiling(true)
    setError('')
    try {
      const res = await fetch('/api/tools/img2latex/compile', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const d = typeof data.detail === 'object' ? data.detail : {}
        throw new Error(d.log ? `${d.message || t('img2latex.err.compile')}\n${d.log.slice(-600)}` : (d.message || data.detail || t('img2latex.err.compile')))
      }
      const blob = await res.blob()
      if (pdfBlobRef.current) URL.revokeObjectURL(pdfBlobRef.current)
      const url = URL.createObjectURL(blob)
      pdfBlobRef.current = url
      setPdfUrl(url)
    } catch (e) {
      setError(e.message || t('img2latex.err.compile'))
    } finally {
      setCompiling(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main i2l-main">
        <header className="tool-header">
          <Link to="/tools" className="tool-back">{t('img2latex.backToTools')}</Link>
          <h1 className="tool-title">{t('img2latex.title')}</h1>
          <p className="tool-subtitle">{t('img2latex.subtitle')}</p>
        </header>

        {!token && (
          <div className="tool-login-hint">
            {t('img2latex.loginHint')}<Link to="/login">{t('img2latex.goLogin')}</Link>
          </div>
        )}

        {error && <div className="i2l-error"><pre>{error}</pre></div>}

        {/* ① 上传图片 */}
        <section className="i2l-card">
          <h2 className="i2l-card-title">{t('img2latex.step.images')}</h2>
          <div
            className={`i2l-drop ${images.length ? 'has' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (token) addImages(e.dataTransfer.files) }}
          >
            <UiIcon name="image" size={22} />
            <span>{t('img2latex.dropHint')}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={e => { if (token) addImages(e.target.files); e.target.value = '' }}
            />
          </div>
          {images.length > 0 && (
            <div className="i2l-thumbs">
              {images.map((it, i) => (
                <div key={it.url} className="i2l-thumb">
                  <img src={it.url} alt={`preview-${i + 1}`} />
                  <button type="button" className="i2l-thumb-del" title={t('img2latex.removeImage')} onClick={() => removeImage(i)}>×</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            className="i2l-notes"
            rows={2}
            placeholder={t('img2latex.notesPlaceholder')}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <button className="btn btn-primary i2l-btn" onClick={handleGenerate} disabled={!token || genLoading || images.length === 0}>
            {genLoading ? t('img2latex.generating') : t('img2latex.generate')}
          </button>
        </section>

        {/* ② LaTeX 代码 */}
        {code && (
          <section className="i2l-card">
            <h2 className="i2l-card-title">{t('img2latex.step.code')}</h2>
            <textarea
              className="i2l-code"
              rows={14}
              spellCheck={false}
              value={code}
              onChange={e => setCode(e.target.value)}
            />
            <div className="i2l-btn-row">
              <button className="btn btn-secondary i2l-btn-sm" onClick={handleCopy}>{copied ? t('img2latex.copied') : t('img2latex.copyCode')}</button>
              <button className="btn btn-primary i2l-btn-sm" onClick={handleCompile} disabled={compiling || !engine}
                title={!engine ? t('img2latex.noEngine') : ''}>
                {compiling ? t('img2latex.compiling') : t('img2latex.compile')}
              </button>
            </div>
            {!engine && <p className="i2l-engine-hint">{t('img2latex.noEngine')}</p>}
          </section>
        )}

        {/* ③ PDF 预览 */}
        {pdfUrl && (
          <section className="i2l-card">
            <div className="i2l-pdf-head">
              <h2 className="i2l-card-title">{t('img2latex.step.pdf')}</h2>
              <a className="btn btn-secondary i2l-btn-sm" href={pdfUrl} download="document.pdf">{t('img2latex.downloadPdf')}</a>
            </div>
            <iframe className="i2l-pdf" src={pdfUrl} title="PDF preview" />
          </section>
        )}
      </div>

      <Modal
        open={showConfigModal}
        title={t('img2latex.configModal.title')}
        message={t('img2latex.configModal.message')}
        confirmText={t('videoSummary.configModal.goToSettings')}
        cancelText={t('modal.cancel')}
        showCancel
        onConfirm={gotoAiSettings}
        onCancel={() => setShowConfigModal(false)}
      />
    </div>
  )
}

export default Img2LatexPage