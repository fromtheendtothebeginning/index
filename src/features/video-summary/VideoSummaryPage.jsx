import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import ActionButton from '../../components/ActionButton'
import Modal from '../../components/Modal'
import { renderMd } from '../../utils/markdown'
import { t } from '../../i18n'
import '../../pages/ToolParsePage.css'
import './VideoSummaryPage.css'

const SOURCE_LABEL = {
  asr: 'videoSummary.source.asr',
  ocr: 'videoSummary.source.ocr',
  'asr+ocr': 'videoSummary.source.asrOcr',
  subtitle: 'videoSummary.source.subtitle',
  auto_subtitle: 'videoSummary.source.autoSubtitle',
  metadata: 'videoSummary.source.metadata',
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 流式中间态渲染：抹掉未闭合的数学分隔符，避免 KaTeX 吃到残片（$ / $$ / \( \) / \[ \]）
function streamSafeMd(raw) {
  let t = raw
  const dd = (t.match(/\$\$/g) || []).length
  if (dd % 2 === 1) t = t.replace(/\$\$([\s\S]*)$/, '$1')
  const d = (t.match(/(?<!\\)\$/g) || []).length
  if (d % 2 === 1) t = t.replace(/(?<!\\)\$([^\n$]*)$/, '$1')
  t = t.replace(/\\\(\s*$/, '').replace(/\\\[\s*$/, '')
  t = t.replace(/\s*\\\)$/, '').replace(/\s*\\\]$/, '')
  return renderMd(t)
}

export default function VideoSummaryPage() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [useAsr, setUseAsr] = useState(false)
  const [progress, setProgress] = useState(null)
  const [liveText, setLiveText] = useState('')
  const streamCtlRef = useRef(null)
  const [history, setHistory] = useState([])
  const [viewingId, setViewingId] = useState(null)

  // 进入页面：恢复上次成果/进度 + 拉取历史
  useEffect(() => {
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    fetch('/api/tools/video-summary/state', { headers })
      .then(r => r.json())
      .then(d => {
        if (d?.active && d.active.status === 'running') {
          setProgress({ percent: d.active.percent, stage: d.active.stage })
          setLoading(true)
          pollTask(d.active.task_id)
        } else if (d?.last_result) {
          setResult(d.last_result)
        }
      })
      .catch(() => {})
    loadHistory()
  }, [])

  function loadHistory() {
    fetch('/api/tools/video-summary/history', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.json())
      .then(d => setHistory(d.history || []))
      .catch(() => {})
  }

  function viewHistory(id) {
    setViewingId(id)
    setError('')
    fetch(`/api/tools/video-summary/history/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.json())
      .then(d => { setResult(d); setCopied(false) })
      .catch(e => setError(t('videoSummary.history.loadError')))
  }

  // 关闭流式连接
  useEffect(() => () => { if (streamCtlRef.current) streamCtlRef.current.abort() }, [])

  // fetch 流式读取（可带 Authorization 头，EventSource 做不到）
  function startStream(taskId) {
    const ctl = new AbortController()
    streamCtlRef.current = ctl
    fetch(`/api/tools/video-summary/stream?task_id=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctl.signal,
    })
      .then(resp => {
        if (!resp.ok || !resp.body) return
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        const pump = () => reader.read().then(({ done, value }) => {
          if (done) return
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data:')) continue
              const payload = line.slice(5).trim()
              if (payload === '[DONE]') { reader.cancel(); return }
              try {
                const d2 = JSON.parse(payload)
                if (d2.delta) setLiveText(t => t + d2.delta)
              } catch { /* 忽略坏帧 */ }
            }
          }
          return pump()
        }).catch(() => {})
        return pump()
      })
      .catch(() => {})
  }

  function handleSummarize() {
    setError('')
    setResult(null)
    setCopied(false)
    setProgress({ percent: 1, stage: t('videoSummary.stage.preparing') })
    if (!/^https?:\/\//.test(url.trim())) {
      setError(t('videoSummary.input.invalidUrl'))
      return
    }
    setLoading(true)
    fetch('/api/tools/video-summary/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: url.trim(), use_asr: useAsr }),
    })
      .then(async r => {
        const raw = await r.text()
        let d
        try { d = JSON.parse(raw) } catch { d = null }
        if (!r.ok || d == null || !d.task_id) {
          const detail = d && typeof d === 'object' ? d.detail : null
          throw detail || (d && typeof d === 'string' ? d : null) || new Error(t('videoSummary.error.requestWithStatus', { status: r.status }))
        }
        return d.task_id
      })
      .then(taskId => pollTask(taskId))
      .catch(e => {
        if (e && e.code === 'ai_config') setShowConfigModal(true)
        else setError(typeof e === 'string' ? e : (e.message || t('videoSummary.error.request')))
        setProgress(null)
        setLoading(false)
      })
  }

  function pollTask(taskId) {
    const tick = () => {
      fetch(`/api/tools/video-summary/progress?task_id=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(d => {
          if (d.status === 'done') {
            if (streamCtlRef.current) { streamCtlRef.current.abort(); streamCtlRef.current = null }
            setProgress(null)
            setResult(d.result)
            setLiveText('')
            setLoading(false)
            loadHistory()
            return
          }
          if (d.status === 'failed') throw d.error
          setProgress({ percent: d.percent, stage: d.stage })
          // 进入 AI 总结阶段 → 开启流式显示（fetch + ReadableStream，带鉴权头）
          if (d.stage === 'AI 总结' && !streamCtlRef.current) {
            startStream(taskId)
          }
          setTimeout(tick, 1200)
        })
        .catch(e => {
          if (e && typeof e === 'object' && e.code === 'ai_config') setShowConfigModal(true)
          else setError(typeof e === 'string' ? e : (typeof e?.message === 'string' ? e.message : JSON.stringify(e)))
          if (streamCtlRef.current) { streamCtlRef.current.abort(); streamCtlRef.current = null }
          setProgress(null)
          setLoading(false)
        })
    }
    tick()
  }

  async function copyMd() {
    if (!result?.summary_md) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(result.summary_md)
      } else {
        const ta = document.createElement('textarea')
        ta.value = result.summary_md
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(t('videoSummary.copyFailed'))
    }
  }

  function gotoAiSettings() {
    localStorage.setItem('my_tab', 'ai')
    setShowConfigModal(false)
    navigate('/my')
  }

  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main vs-main">
        <div className="vs-layout">
          {/* 左侧：历史任务栏（DeepSeek 风格） */}
          <aside className="vs-sidebar">
            <div className="vs-sidebar-head">
              <span className="vs-sidebar-title">{t('videoSummary.history.title')}</span>
              <span className="vs-sidebar-sub">{history.length}/20</span>
            </div>
            <div className="vs-sidebar-list">
              {history.length === 0 ? (
                <div className="vs-sidebar-empty">{t('videoSummary.history.empty')}</div>
              ) : (
                history.map(h => (
                  <button
                    type="button"
                    key={h.id}
                    className={`vs-sidebar-item ${h.status === 'failed' ? 'failed' : ''} ${viewingId === h.id ? 'active' : ''}`}
                    onClick={() => viewHistory(h.id)}
                  >
                    <span className="vs-sidebar-name">{h.title || t('videoSummary.history.unnamed')}</span>
                    <span className="vs-sidebar-meta">
                      {h.status === 'failed' ? t('videoSummary.status.failed') : `${t(SOURCE_LABEL[h.source]) || h.source} · ${h.model || ''}`}
                      {' · '}{fmtTime(h.created_at)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* 右侧：表单 + 结果 */}
          <section className="vs-content">
            <header className="tool-header">
              <Link to="/tools" className="tool-back">{t('videoSummary.backToTools')}</Link>
              <h1 className="tool-title">{t('videoSummary.title')}</h1>
              <p className="tool-subtitle">{t('videoSummary.subtitle')}</p>
            </header>

            {!token && (
              <div className="tool-login-hint">
                {t('videoSummary.loginHint')}<Link to="/login">{t('videoSummary.goLogin')}</Link>
              </div>
            )}

            <div className="tool-input-row">
              <input
                className="tool-input"
                placeholder={t('videoSummary.source.placeholder')}
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading && token) handleSummarize() }}
                disabled={!token}
              />
            </div>

            <div className="vs-options-row">
              <label className="vs-checkbox">
                <input type="checkbox" checked={useAsr} onChange={e => setUseAsr(e.target.checked)} disabled={loading || !token} />
                <span>{t('videoSummary.useAsr')}</span>
              </label>
              <ActionButton variant="accent" onClick={handleSummarize} disabled={loading || !token} className="vs-submit">
                {loading ? t('videoSummary.generating') : t('videoSummary.generate')}
              </ActionButton>
            </div>

            {error && <div className="tool-error">{error}</div>}
            {loading && progress && (
              <div className="tool-dl-progress">
                <div className="tool-dl-bar">
                  <div className="tool-dl-fill" style={{ width: `${progress.percent}%` }} />
                </div>
                <span className="tool-dl-text">{progress.stage} {progress.percent}%</span>
              </div>
            )}
            {loading && (
              <div className="tool-login-hint vs-loading-hint">
                {t('videoSummary.loadingHint')}
              </div>
            )}

            {loading && liveText && (
              <div className="vs-result vs-streaming">
                <div className="vs-streaming-head">
                  <span className="vs-streaming-dot" />
                  {t('videoSummary.streamingGenerating')}{progress?.stage === '排版校对' ? t('videoSummary.streamingProofreading') : ''}
                </div>
                <div className="markdown-body vs-summary" dangerouslySetInnerHTML={{ __html: streamSafeMd(liveText) }} />
              </div>
            )}

            {result && (
              <div className="vs-result">
                <div className="vs-result-head">
                  <div className="vs-result-title">
                    <h2>{result.video?.title}</h2>
                    <span className="vs-meta">
                      {result.video?.uploader}
                      {result.video?.duration ? ` · ${t('videoSummary.meta.duration', { minutes: Math.floor(result.video.duration / 60), seconds: result.video.duration % 60 })}` : ''}
                      {' · '}{t('videoSummary.meta.source')}{t(SOURCE_LABEL[result.source]) || result.source}
                      {' · '}{t('videoSummary.meta.transcript', { chars: result.transcript_chars })}{result.truncated ? t('videoSummary.meta.truncated') : ''}
                      {' · '}{result.model}
                    </span>
                  </div>
                  <ActionButton variant="accent" onClick={copyMd} className={copied ? 'vs-copied' : ''}>
                    {copied ? t('videoSummary.copied') : t('videoSummary.copyMd')}
                  </ActionButton>
                </div>
                <div className="markdown-body vs-summary" dangerouslySetInnerHTML={{ __html: renderMd(result.summary_md) }} />
                <p className="tool-disclaimer">{t('videoSummary.disclaimer')}</p>
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={showConfigModal}
        title={t('videoSummary.configModal.title')}
        message={t('videoSummary.configModal.message')}
        confirmText={t('videoSummary.configModal.goToSettings')}
        cancelText={t('videoSummary.configModal.cancel')}
        showCancel
        onConfirm={gotoAiSettings}
        onCancel={() => setShowConfigModal(false)}
      />
    </div>
  )
}
