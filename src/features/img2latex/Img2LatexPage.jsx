import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Modal from '../../components/Modal'
import { UiIcon } from '../../components/Icons'
import { t } from '../../i18n'
import '../../pages/ToolParsePage.css'
import './Img2LatexPage.css'

const STEPS = [1, 2, 3]

function Img2LatexPage() {
  const token = localStorage.getItem('token')
  // 向导状态
  const [step, setStep] = useState(1)
  const [files, setFiles] = useState([])            // [{ file|null, name, kind, url, saved }]
  const [notes, setNotes] = useState('')
  const [code, setCode] = useState('')
  const [pdfUrl, setPdfUrl] = useState(null)
  // 异步状态
  const [loading, setLoading] = useState(false)     // 会话恢复中
  const [genLoading, setGenLoading] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [engine, setEngine] = useState(true)
  const [error, setError] = useState('')
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const dropInputRef = useRef(null)

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

  // 进入页面：引擎可用性 + 恢复会话快照（含 PDF）
  useEffect(() => {
    if (!token) return
    fetch('/api/tools/img2latex/available', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setEngine(!!d.engine))
      .catch(() => {})
    fetch('/api/tools/img2latex/session', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        const s = d.session
        setStep(s.step || 1)
        setNotes(s.notes || '')
        setCode(s.code || '')
        setFiles((s.files || []).map(f => ({ name: f.name, saved: f.saved, kind: f.kind, url: null, file: null })))
        hydrateImageUrls(s.files || [])   // 图片已存文件 → 拉 blob 预览
        // PDF 预览需鉴权（iframe 无法带 header），用带 Authorization 的 fetch 拉取后转 blob
        if (s.pdf) {
          fetch(s.pdf, { headers: authHeaders() })
            .then(r => { if (!r.ok) throw new Error(); return r.blob() })
            .then(blob => setPdfUrl(URL.createObjectURL(blob)))
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // 合并拖拽/选择：按扩展名自动分辨图片与 md
  function addFiles(fileList) {
    const next = []
    for (const f of fileList) {
      const isImage = f.type.startsWith('image/')
      const isMd = /\.(md|markdown)$/i.test(f.name)
      if (!isImage && !isMd) continue
      const imgCount = files.filter(x => x.kind === 'image').length + next.filter(x => x.kind === 'image').length
      const mdCount = files.filter(x => x.kind === 'md').length + next.filter(x => x.kind === 'md').length
      if (isImage && imgCount >= 5) continue
      if (isMd && mdCount >= 2) continue
      next.push({ file: f, name: f.name, kind: isImage ? 'image' : 'md', url: isImage ? URL.createObjectURL(f) : null, saved: null })
    }
    if (next.length) setFiles(prev => [...prev, ...next])
  }

  function removeFile(i) {
    setFiles(prev => {
      const target = prev[i]
      if (target.url) URL.revokeObjectURL(target.url)
      return prev.filter((_, idx) => idx !== i)
    })
  }

  function gotoAiSettings() {
    sessionStorage.setItem('profile_redirect', '/tools/img2latex')
    window.location.href = '/profile'
  }

  function e_isAiConfig(data) {
    return data && typeof data.detail === 'object' && data.detail.code === 'ai_config'
  }

  // 图片预览一律用 blob（iframe/img 无法带 Authorization header 直接访问后端文件）：
  // 对「已保存到后端但本地无 File 且未持有 blob」的图片，用带鉴权的 fetch 拉取转 blob
  function hydrateImageUrls(list) {
    const imgs = list.filter(f => f.kind === 'image' && !f.url && f.saved)
    if (!imgs.length) return
    imgs.forEach(f => {
      fetch(`/api/tools/img2latex/session/file/${f.saved}`, { headers: authHeaders() })
        .then(r => (r.ok ? r.blob() : null))
        .then(b => {
          if (b) setFiles(prev => prev.map(x => x.saved === f.saved ? { ...x, url: URL.createObjectURL(b) } : x))
        })
        .catch(() => {})
    })
  }

  // 保存第 1 步输入到后端会话（撤销/恢复 + 二次生成用）
  async function saveStep1(nextStep = 2) {
    if (saving) return false
    setSaving(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('step', String(nextStep))
      fd.append('notes', notes)
      const local = files.filter(f => f.file)
      const savedOnly = files.filter(f => !f.file && f.saved)
      if (local.length === 0 && savedOnly.length === 0) {
        setError(t('img2latex.err.noInput'))
        return false
      }
      // 保留后端已存文件（回退/刷新恢复的，无需重新上传）；未保留的旧文件后端会清理
      fd.append('keep_saved', savedOnly.map(f => f.saved).join(','))
      local.forEach(f => fd.append(f.kind === 'image' ? 'images' : 'md_files', f.file))
      const res = await fetch('/api/tools/img2latex/session', {
        method: 'POST', headers: authHeaders(), body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.detail === 'object' ? data.detail.message : (data.detail || t('img2latex.err.saveFailed')))
      // 合并：本地 File 保留 blob 预览；已存文件稍后由 hydrateImageUrls 拉取
      setFiles((data.session.files || []).map(sf => {
        const localFile = files.find(f => f.name === sf.name && f.file)
        return { ...sf, file: localFile ? localFile.file : null, url: localFile ? localFile.url : null }
      }))
      hydrateImageUrls(data.session.files || [])
      // 代码/PDF 以后端判定为准：输入无变化则保留（回退后直接推进），有变化则被清空
      setCode(data.session.code || '')
      if (data.session.pdf) {
        fetch(data.session.pdf, { headers: authHeaders() })
          .then(r => (r.ok ? r.blob() : null))
          .then(b => { if (b) setPdfUrl(URL.createObjectURL(b)) })
          .catch(() => {})
      } else {
        setPdfUrl(null)
      }
      return true
    } catch (e) {
      setError(e.message || t('img2latex.err.saveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveStep(n) {
    try {
      await fetch('/api/tools/img2latex/session/step', {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: n }),
      })
    } catch { /* 静默 */ }
  }

  async function saveCode(c) {
    try {
      await fetch('/api/tools/img2latex/session/code', {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c }),
      })
    } catch { /* 静默 */ }
  }

  // ── 步骤 1 → 2 ──
  async function goNext1() {
    const ok = await saveStep1(2)
    if (ok) {
      setStep(2)
      await saveStep(2)
    }
  }

  // ── 步骤 2：生成 ──
  async function handleGenerate() {
    if (genLoading) return
    if (!code && files.length === 0 && !notes.trim()) {
      setError(t('img2latex.err.noInput'))
      return
    }
    setGenLoading(true)
    setError('')
    try {
      const fd = new FormData()
      files.filter(f => f.file).forEach(f => fd.append(f.kind === 'image' ? 'images' : 'md_files', f.file))
      if (files.every(f => !f.file)) fd.append('use_session', '1')
      fd.append('notes', notes)
      const res = await fetch('/api/tools/img2latex/generate', {
        method: 'POST', headers: authHeaders(), body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (e_isAiConfig(data)) { setShowConfigModal(true); return }
      if (!res.ok) throw new Error(typeof data.detail === 'object' ? data.detail.message : (data.detail || t('img2latex.err.generate')))
      setCode(data.code || '')
      setPdfUrl(null)   // 新代码 → 旧 PDF 失效
      saveCode(data.code || '')
    } catch (e) {
      setError(e.message || t('img2latex.err.generate'))
    } finally {
      setGenLoading(false)
    }
  }

  // ── 步骤 2 → 3 ──
  function goNext2() {
    if (!code.trim()) { setError(t('img2latex.err.needCode')); return }
    saveCode(code)
    setError('')
    setStep(3)
    saveStep(3)
  }

  // ── 步骤 3：编译 ──
  async function handleCompile() {
    if (compiling || !code.trim()) return
    setCompiling(true)
    setError('')
    try {
      const res = await fetch('/api/tools/img2latex/compile', {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const d = typeof data.detail === 'object' ? data.detail : {}
        throw new Error(d.log ? `${d.message || t('img2latex.err.compile')}\n${d.log.slice(-600)}` : (d.message || data.detail || t('img2latex.err.compile')))
      }
      const blob = await res.blob()
      // 预览始终用本地 blob（iframe 无法带 Authorization header，直接显示后端 URL 会 401 空白）
      if (pdfUrl && pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl)
      setPdfUrl(URL.createObjectURL(blob))
      // 同步保存到后端会话（刷新/回退后带鉴权 fetch 拉取恢复）；失败不影响本次预览
      try {
        const pfd = new FormData()
        pfd.append('file', blob, 'document.pdf')
        await fetch('/api/tools/img2latex/session/pdf', { method: 'POST', headers: authHeaders(), body: pfd })
      } catch { /* 静默 */ }
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

  // ── 向前跳转撤销 ──
  function goBack() {
    if (step === 2) { setStep(1); saveStep(1) }
    else if (step === 3) { setStep(2); saveStep(2) }
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

        {/* 步骤指示器 */}
        <div className="i2l-stepper">
          {STEPS.map(n => (
            <button
              key={n}
              type="button"
              className={`i2l-step ${step === n ? 'active' : ''} ${step > n ? 'done' : ''}`}
              onClick={() => {
                if (n === 2 && step === 1) return goNext1()
                if (n === 3 && step === 2) return goNext2()
                if (n < step) { setStep(n); saveStep(n) }
              }}
            >
              <span className="i2l-step-num">{step > n ? '✓' : n}</span>
              <span className="i2l-step-label">{t(`img2latex.stepNav.${n}`)}</span>
            </button>
          ))}
        </div>

        {error && <div className="i2l-error"><pre>{error}</pre></div>}

        {/* ① 上传内容 */}
        {step === 1 && (
          <section className="i2l-card">
            <h2 className="i2l-card-title">{t('img2latex.step.images')}</h2>
            <div
              className={`i2l-drop ${files.length ? 'has' : ''}`}
              onClick={() => dropInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (token) addFiles(e.dataTransfer.files) }}
            >
              <UiIcon name="image" size={22} />
              <span>{t('img2latex.dropHint')}</span>
              <input
                ref={dropInputRef}
                type="file"
                accept="image/*,.md,.markdown"
                multiple
                hidden
                onChange={e => { if (token) addFiles(e.target.files); e.target.value = '' }}
              />
            </div>
            {files.length > 0 && (
              <div className="i2l-files">
                {files.map((it, i) => (
                  <div key={`${it.name}-${i}`} className={`i2l-file-item ${it.kind === 'image' ? 'image' : 'md'}`}>
                    {it.kind === 'image' ? (
                      <img src={it.url} alt={it.name} className="i2l-file-thumb" />
                    ) : (
                      <span className="i2l-file-md-icon"><UiIcon name="text" size={16} /></span>
                    )}
                    <span className="i2l-file-name">{it.name}</span>
                    <button type="button" className="i2l-thumb-del" title={t('img2latex.removeImage')} onClick={() => removeFile(i)}>×</button>
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
            <div className="i2l-nav-row">
              <button className="btn btn-primary i2l-btn" onClick={goNext1} disabled={!token || saving}>
                {saving ? t('img2latex.saving') : t('img2latex.next')}
              </button>
            </div>
          </section>
        )}

        {/* ② LaTeX 代码 */}
        {step === 2 && (
          <section className="i2l-card">
            <h2 className="i2l-card-title">{t('img2latex.step.code')}</h2>
            {!code && (
              <button className="btn btn-primary i2l-btn" onClick={handleGenerate} disabled={!token || genLoading}>
                {genLoading ? t('img2latex.generating') : t('img2latex.generate')}
              </button>
            )}
            <textarea
              className="i2l-code"
              rows={16}
              spellCheck={false}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t('img2latex.codePlaceholder')}
            />
            <div className="i2l-btn-row">
              <button className="btn btn-secondary i2l-btn-sm" onClick={handleGenerate} disabled={genLoading}>
                {genLoading ? t('img2latex.generating') : t('img2latex.regenerate')}
              </button>
              <button className="btn btn-secondary i2l-btn-sm" onClick={handleCopy}>{copied ? t('img2latex.copied') : t('img2latex.copyCode')}</button>
            </div>
            <div className="i2l-nav-row">
              <button className="btn btn-secondary i2l-btn" onClick={goBack}>{t('img2latex.back')}</button>
              <button className="btn btn-primary i2l-btn" onClick={goNext2}>{t('img2latex.next')}</button>
            </div>
          </section>
        )}

        {/* ③ 编译结果 */}
        {step === 3 && (
          <section className="i2l-card">
            <h2 className="i2l-card-title">{t('img2latex.step.pdf')}</h2>
            {pdfUrl ? (
              <>
                <div className="i2l-pdf-head">
                  <div className="i2l-btn-row">
                    <button className="btn btn-primary i2l-btn-sm" onClick={handleCompile} disabled={compiling}
                      title={!engine ? t('img2latex.noEngine') : ''}>
                      {compiling ? t('img2latex.compiling') : t('img2latex.recompile')}
                    </button>
                    <a className="btn btn-secondary i2l-btn-sm" href={pdfUrl} download="document.pdf">{t('img2latex.downloadPdf')}</a>
                  </div>
                </div>
                <iframe className="i2l-pdf" src={pdfUrl} title="PDF preview" />
              </>
            ) : (
              <div className="i2l-pdf-empty">
                <p>{t('img2latex.compileHint')}</p>
                <div className="i2l-btn-row">
                  <button className="btn btn-primary i2l-btn-sm" onClick={handleCompile} disabled={compiling || !engine}
                    title={!engine ? t('img2latex.noEngine') : ''}>
                    {compiling ? t('img2latex.compiling') : t('img2latex.compile')}
                  </button>
                  {!engine && <p className="i2l-engine-hint">{t('img2latex.noEngine')}</p>}
                </div>
              </div>
            )}
            <div className="i2l-nav-row">
              <button className="btn btn-secondary i2l-btn" onClick={goBack}>{t('img2latex.back')}</button>
            </div>
          </section>
        )}
      </div>

      <Modal
        open={showConfigModal}
        title={t('img2latex.configModal.title')}
        message={t(files.some(f => f.kind === 'image') ? 'img2latex.configModal.messageVision' : 'img2latex.configModal.messageMain')}
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