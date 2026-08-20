import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import CategoryDropdown from '../components/CategoryDropdown'
import { UiIcon, ContactIcon } from '../components/Icons'
import './ToolParsePage.css'

function fmtDur(sec) {
  if (!sec && sec !== 0) return '-'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`
}

function fmtSize(bytes) {
  if (!bytes) return '-'
  const mb = bytes / 1024 / 1024
  return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

function ToolParsePage() {
  const token = localStorage.getItem('token')
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState(null)
  const [chosen, setChosen] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState(0)
  const [saving, setSaving] = useState(false)
  const [coverUrl, setCoverUrl] = useState('')
  const objectUrls = useRef([])
  // 平滑动画：轮询设定目标值，动画每帧逼近（单调不减防回退，无外推无分段）
  const targetRef = useRef(0)
  const animRef = useRef(0)
  const shownRef = useRef(0)

  useEffect(() => {
    let raf
    const tick = () => {
      const diff = targetRef.current - animRef.current
      animRef.current = Math.abs(diff) < 0.2 ? targetRef.current : animRef.current + diff * 0.15
      const rounded = Math.round(animRef.current)
      if (rounded !== shownRef.current) {
        shownRef.current = rounded
        setProgress(prev => Math.max(prev, rounded))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    return () => { objectUrls.current.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  const authHeaders = { Authorization: `Bearer ${token}` }

  // 封面走后端代理（绕过 bilibili 防盗链/临时 URL 过期），带鉴权 fetch 后转 objectURL
  const loadCover = async (thumbUrl) => {
    if (!thumbUrl) { setCoverUrl(''); return }
    try {
      const r = await fetch(`/api/tools/thumb?url=${encodeURIComponent(thumbUrl)}`, { headers: authHeaders })
      if (r.ok) {
        const blob = await r.blob()
        const u = URL.createObjectURL(blob)
        objectUrls.current.push(u)
        setCoverUrl(u)
      }
    } catch { /* 失败则显示占位图 */ }
  }

  const parse = async () => {
    if (!token) { setErr('请先登录后使用工具'); return }
    const u = url.trim()
    if (!u) { setErr('请输入视频链接'); return }
    setErr(''); setLoading(true); setInfo(null); setChosen(''); setCoverUrl('')
    try {
      const r = await fetch(`/api/tools/video/info?url=${encodeURIComponent(u)}`, { headers: authHeaders })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || '解析失败')
      const formats = d.info.formats || []
      setInfo(d.info)
      // 默认选中倒数第二清晰度（次高画质），没有则选最后一项
      const def = formats.length >= 2 ? formats[formats.length - 2] : formats[formats.length - 1]
      if (def) setChosen(String(def.height))
      loadCover(d.info.thumbnail)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const download = async () => {
    if (!token) { setErr('请先登录后使用工具'); return }
    setErr(''); setDownloading(true); setProgress(0); setSaving(false)
    try {
      // 1. 创建下载任务
      const cr = await fetch('/api/tools/video/download-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!cr.ok) {
        const cd = await cr.json().catch(() => ({}))
        throw new Error(cd.detail || '创建任务失败')
      }
      const { task_id } = await cr.json()

      // 2. 轮询后端 yt-dlp 下载进度（设定目标值，动画平滑逼近）
      const timer = setInterval(async () => {
        try {
          const pr = await fetch(`/api/tools/video/download-progress?task_id=${task_id}`, { headers: authHeaders })
          const pd = await pr.json()
          targetRef.current = pd.progress || 0
          if (pd.status === 'done') {
            clearInterval(timer)
            targetRef.current = 100
            // 3. 下载完成，拉取文件保存（进度条满，按钮显示保存中）
            setSaving(true)
            const fr = await fetch(`/api/tools/video/download-file?task_id=${task_id}`, { headers: authHeaders })
            if (!fr.ok) throw new Error('获取文件失败')
            const blob = await fr.blob()
            const a = document.createElement('a')
            const objUrl = URL.createObjectURL(blob)
            a.href = objUrl
            a.download = ((info && info.title) || 'video').replace(/[\\/:*?"<>|]/g, '_') + '.mp4'
            document.body.appendChild(a)
            a.click()
            a.remove()
            setTimeout(() => URL.revokeObjectURL(objUrl), 10000)
            setProgress(100)
            setSaving(false)
            setDownloading(false)
          } else if (pd.status === 'failed') {
            clearInterval(timer)
            throw new Error(pd.error || '下载失败')
          }
        } catch (e) {
          clearInterval(timer)
          setErr(e.message)
          setSaving(false)
          setDownloading(false)
        }
      }, 600)
    } catch (e) { setErr(e.message); setSaving(false); setDownloading(false) }
  }

  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main">
        <header className="tool-header">
          <Link to="/tools" className="tool-back">← 返回工具主页</Link>
          <h1 className="tool-title">视频解析</h1>
          <p className="tool-subtitle">解析 B站视频信息与清晰度，并可下载为 mp4（需登录）</p>
        </header>

        {!token && (
          <div className="tool-login-hint">
            工具需要登录后使用。<Link to="/login">去登录</Link>
          </div>
        )}

        <div className="tool-input-row">
          <input
            className="tool-input"
            placeholder="粘贴视频链接，如 https://www.bilibili.com/video/BVxxxx"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') parse() }}
          />
          <button className="btn btn-primary tool-btn" onClick={parse} disabled={loading || !token}>
            {loading ? '解析中...' : '解析'}
          </button>
        </div>

        {err && <div className="tool-error">{err}</div>}

        {info && (
          <div className="tool-card">
            <div className="tool-card-cover">
              {coverUrl ? (
                <img src={coverUrl} alt={info.title} />
              ) : (
                <div className="tool-card-cover-fallback"><ContactIcon icon="bilibili" className="tool-brand-icon" /></div>
              )}
            </div>
            <div className="tool-card-body">
              <h2 className="tool-card-title">{info.title}</h2>
              <div className="tool-meta-grid">
                <div className="tool-meta-item">
                  <span className="tool-meta-label">UP 主</span>
                  <span>{info.uploader || '-'}</span>
                </div>
                <div className="tool-meta-item">
                  <span className="tool-meta-label">时长</span>
                  <span>{fmtDur(info.duration)}</span>
                </div>
              </div>
              <div className="tool-formats">
                <div className="tool-formats-label">可用清晰度</div>
                <div className="tool-format-list">
                  {(info.formats || []).map(f => (
                    <span key={f.height} className="tool-format-chip">
                      {f.height}p{f.ext ? ` · ${f.ext}` : ''}
                      <em>{fmtSize(f.size)}</em>
                    </span>
                  ))}
                </div>
              </div>
              <div className="tool-format-row">
                <CategoryDropdown
                  value={chosen}
                  onChange={setChosen}
                  options={(info.formats || []).map(f => ({
                    value: String(f.height),
                    label: `${f.height}p${f.ext ? ` (${f.ext})` : ''}${f.size ? ` · ${fmtSize(f.size)}` : ''}`,
                  }))}
                  placeholder="选择清晰度下载"
                  hideClear
                />
                <button
                  className="btn btn-primary tool-btn"
                  onClick={download}
                  disabled={downloading || !chosen || !token}
                >
                  {downloading ? (saving ? '保存中...' : `${progress}%`) : '下载'}
                </button>
              </div>
              {downloading && (
                <div className="tool-dl-progress">
                  <div className="tool-dl-bar">
                    <div className="tool-dl-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="tool-dl-text">{saving ? `保存中 ${progress}%` : `下载中 ${progress}%`}</span>
                </div>
              )}
              <a
                className="tool-origin-link"
                href={info.webpage_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                前往原视频页
                <UiIcon name="link" size={14} />
              </a>
              <p className="tool-disclaimer">仅供个人学习与研究使用，请遵守相关平台条款与版权法规。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ToolParsePage