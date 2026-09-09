import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Modal from '../../components/Modal'
import CategoryDropdown from '../../components/CategoryDropdown'
import { t } from '../../i18n'
import '../../pages/ToolParsePage.css'
import './CampusServicePage.css'

const STUDENT_LABELS = [
  ['xh', 'campusService.score.student.xh'],
  ['xm', 'campusService.score.student.xm'],
  ['nj', 'campusService.score.student.nj'],
  ['bmmc', 'campusService.score.student.bmmc'],
  ['zymc', 'campusService.score.student.zymc'],
  ['bjmc', 'campusService.score.student.bjmc'],
]

const VALID_FEATURES = ['score', 'grades', 'ecard', 'electricity']

const KIND_LABELS = {
  score: 'campusService.query.score',
  grades: 'campusService.query.grades',
  ecard: 'campusService.query.ecard',
  electricity: 'campusService.electricity.name',
}

// 第二课堂达标分数（2025级）
const TOTAL_TARGET = 8
// 分组达标（一级板块）
const SCORE_TARGETS = [
  { keywords: ['德育'], target: 3.0 },
  { keywords: ['劳育'], target: 3.0 },
  { keywords: ['美育'], target: 1.0, noExpand: true },
  { keywords: ['健康'], target: 1.0, noExpand: true },
]
// 子项达标（二级板块，仅德育/劳育有）
const SUB_TARGETS = [
  { keywords: ['讲座', '报告', '讲坛', '沙龙', '主题教育', '团日'], target: 1.8 },
  { keywords: ['安全教育', '安全'], target: 0.2 },
  { keywords: ['志愿', '公益'], target: 1.0 },
  { keywords: ['三创', '竞赛', '论文', '专利', '技能证书', '社团活动'], target: 1.5 },
  { keywords: ['社会实践', '挂职', '学长导航', '境外交流'], target: 1.0 },
  { keywords: ['劳动教育', '劳动课堂'], target: null },
  { keywords: ['校园文明', '文明寝室'], target: null },
]

function matchScoreTarget(groupName) {
  if (!groupName) return null
  for (const t of SCORE_TARGETS) {
    if (t.keywords.some(kw => groupName.includes(kw))) return t
  }
  return null
}

function matchSubTarget(rowName) {
  if (!rowName) return null
  for (const t of SUB_TARGETS) {
    if (t.keywords.some(kw => rowName.includes(kw))) return t
  }
  return null
}

// ── 简易 SVG 折线图组件 ──
function MiniLineChart({ data, view }) {
  if (!data || data.length === 0) return null
  const W = 560, H = 180, PAD = { t: 20, r: 20, b: 30, l: 50 }
  const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b

  // 按视图聚合数据
  const now = Date.now()
  const ms = { day: 86400000, week: 604800000, month: 2592000000 }
  const bucket = ms[view] || ms.day
  const filtered = data.filter(d => d.time && new Date(d.time).getTime() >= now - bucket * 30)

  if (filtered.length === 0) return null

  const vals = filtered.map(d => d.remain ?? d.balance ?? 0)
  const minV = Math.min(...vals), maxV = Math.max(...vals)
  const range = maxV - minV || 1

  const points = filtered.map((d, i) => {
    const x = PAD.l + (i / Math.max(filtered.length - 1, 1)) * cw
    const y = PAD.t + ch - ((d.remain ?? d.balance ?? 0) - minV) / range * ch
    return { x, y, v: d.remain ?? d.balance ?? 0, t: d.time }
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

  // Y 轴刻度（4 条）
  const yTicks = [0, 0.33, 0.67, 1].map(f => {
    const v = minV + f * range
    const y = PAD.t + ch - f * ch
    return { v: Math.round(v * 10) / 10, y }
  })

  // X 轴标签
  const xLabels = []
  const step = Math.max(1, Math.floor(points.length / 5))
  for (let i = 0; i < points.length; i += step) {
    const d = new Date(points[i].t)
    const label = view === 'day'
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : view === 'week'
        ? `${d.getMonth() + 1}/${d.getDate()}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    xLabels.push({ x: points[i].x, label })
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cs-elec-svg" preserveAspectRatio="xMidYMid meet">
      {/* Y 轴网格线 + 标签 */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} stroke="var(--border-color)" strokeDasharray="3,3" />
          <text x={PAD.l - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{t.v}</text>
        </g>
      ))}
      {/* X 轴标签 */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{l.label}</text>
      ))}
      {/* 折线 */}
      <path d={pathD} fill="none" stroke="var(--accent-1)" strokeWidth="2" strokeLinejoin="round" />
      {/* 数据点 */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--accent-1)" />
      ))}
    </svg>
  )
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

// ── 本地缓存（上次查询结果） ──
function _cacheKey(feature, userId) {
  return `campus_cache_${feature}_${userId || 'anon'}`
}
function loadCache(feature, userId) {
  try {
    const raw = localStorage.getItem(_cacheKey(feature, userId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function saveCache(feature, userId, data) {
  try {
    localStorage.setItem(_cacheKey(feature, userId), JSON.stringify(data))
  } catch { /* 忽略 */ }
}

export default function CampusServicePage() {
  const { feature } = useParams()
  const isSubPage = VALID_FEATURES.includes(feature)
  const navigate = useNavigate()
  const token = localStorage.getItem('token')

  // ── VPN 连接状态 ──
  const [status, setStatus] = useState(null)
  const [unavailable, setUnavailable] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [credBanner, setCredBanner] = useState(false)
  const [copyLabel, setCopyLabel] = useState('') // 显示「已复制」的 key

  // ── 查询结果 ──
  const [scoreData, setScoreData] = useState(null)
  const [gradeData, setGradeData] = useState(null)
  const [gradeTerms, setGradeTerms] = useState([])
  const [gradeTerm, setGradeTerm] = useState('')
  const [ecardData, setEcardData] = useState(null)
  const [ecardCount, setEcardCount] = useState(0)
  const [qBusy, setQBusy] = useState(null)
  const [errMsg, setErrMsg] = useState('')
  const [cacheLoaded, setCacheLoaded] = useState(false)

  // ── 电费 ──
  const [elecData, setElecData] = useState(null)
  const [elecHistory, setElecHistory] = useState([])
  const [elecView, setElecView] = useState('day') // day | week | month
  const [rechargeOpen, setRechargeOpen] = useState(false)
  const [rechargeAmt, setRechargeAmt] = useState('')
  const [rechargeBusy, setRechargeBusy] = useState(false)
  const [rechargeMsg, setRechargeMsg] = useState('')

  // ── 验证码两段式 ──
  const [captcha, setCaptcha] = useState(null)
  const [capInput, setCapInput] = useState('')
  const [autoCaptchaUsed, setAutoCaptchaUsed] = useState(false)

  // 派生状态（useEffect 依赖用，必须在 useEffect 之前声明）
  const connected = !!(status && !unavailable && status.status === 'connected')

  // 请求竞态防护
  const epochRef = useRef(0)
  const busyRef = useRef(false)

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  )

  // ── 状态获取 / 轮询 ──
  const fetchStatus = useCallback(async () => {
    if (!token) return null
    const ep = epochRef.current
    try {
      const res = await fetch('/api/campus/status', { headers: authHeaders() })
      if (res.status === 503) {
        const b = await res.json().catch(() => null)
        if (ep === epochRef.current) setUnavailable((b && b.detail) ? String(b.detail) : t('campusService.serverUnavailable'))
        return null
      }
      if (!res.ok) return null
      const j = await res.json()
      if (ep === epochRef.current) {
        setStatus(j)
        setUnavailable('')
      }
      return j
    } catch {
      return null
    }
  }, [token, authHeaders])

  // ── 凭据检查（连接由管理员负责，用户只需填好自己的凭据） ──
  const fetchCred = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/campus/cred', { headers: authHeaders() })
      if (!res.ok) return
      const b = await res.json().catch(() => null)
      if (b) setCredBanner(!b.configured)
    } catch { /* 忽略 */ }
  }, [token, authHeaders])

  useEffect(() => {
    if (!token) return
    fetchStatus()
    fetchCred()
  }, [token, fetchStatus, fetchCred])

  // ── 电费历史 ──
  const fetchElecHistory = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/campus/electricity/history?days=90', { headers: authHeaders() })
      if (res.ok) {
        const b = await res.json().catch(() => null)
        if (b && b.records) setElecHistory(b.records)
      }
    } catch { /* 忽略 */ }
  }, [token, authHeaders])

  // ── 从缓存恢复上次查询结果（子页面进入时） ──
  useEffect(() => {
    if (!token || !isSubPage || cacheLoaded) return
    const userId = JSON.parse(localStorage.getItem('user') || '{}').id
    if (feature === 'score') {
      const c = loadCache('score', userId)
      if (c) setScoreData(c)
    } else if (feature === 'grades') {
      const c = loadCache('grades', userId)
      if (c) {
        setGradeData(c)
        if (c.terms && c.terms.length > 0) setGradeTerms(c.terms)
      }
    } else if (feature === 'ecard') {
      // 动态码不缓存（每次都需刷新）
    }
    setCacheLoaded(true)
  }, [token, isSubPage, feature, cacheLoaded])

  // 电费子页面进入时拉取历史记录
  useEffect(() => {
    if (isSubPage && feature === 'electricity' && connected) {
      fetchElecHistory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubPage, feature, connected])

  const shouldPoll = !!(status && !unavailable && (status.status === 'creating' || status.status === 'connecting'))
  useEffect(() => {
    if (!token || !shouldPoll) return
    const timer = setInterval(fetchStatus, 3000)
    return () => clearInterval(timer)
  }, [token, shouldPoll, unavailable, fetchStatus])

  // ── 结果写入 ──
  const applyResult = (kind, data, autoCaptcha) => {
    if (autoCaptcha) setAutoCaptchaUsed(true)
    const userId = JSON.parse(localStorage.getItem('user') || '{}').id
    if (kind === 'score') {
      const scoreResult = (data && data.score) || data || null
      setScoreData(scoreResult)
      if (scoreResult) saveCache('score', userId, scoreResult)
    } else if (kind === 'grades') {
      setGradeData(data || null)
      if (data) saveCache('grades', userId, data)
      if (data && Array.isArray(data.terms) && data.terms.length > 0) {
        setGradeTerms(data.terms)
        setGradeTerm('')
      }
    } else if (kind === 'ecard') {
      setEcardData(data || null)
    } else if (kind === 'electricity') {
      setElecData(data || null)
    }
  }

  // ── 统一查询 ──
  const doQuery = async (kind, params = {}) => {
    if (!token || busyRef.current) return
    busyRef.current = true
    const ep = epochRef.current
    setQBusy(kind)
    setErrMsg('')
    setAutoCaptchaUsed(false)
    if (captcha) { setCaptcha(null); setCapInput('') }

    // 电费走独立端点（不经过通用 query/{kind}）
    if (kind === 'electricity') {
      try {
        const res = await fetch('/api/campus/query/electricity', {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: '{}',
        })
        const b = await res.json().catch(() => null)
        if (ep !== epochRef.current) return
        if (res.status === 503) {
          const msg503 = (b && (b.detail || b.message)) ? String(b.detail || b.message) : t('campusService.serverUnavailable')
          setUnavailable(msg503)
          return
        }
        if (!res.ok) {
          const raw = b && (b.detail || b.message)
          const msg = raw ? (Array.isArray(raw) ? raw.map(e => e.msg || String(e)).join('; ') : String(raw)) : t('campusService.error')
          setErrMsg(msg)
          return
        }
        if (b && b.data) applyResult('electricity', b.data)
        // 查询成功后刷新历史
        fetchElecHistory()
      } catch {
        if (ep === epochRef.current) setErrMsg(t('campusService.error'))
      } finally {
        busyRef.current = false
        if (ep === epochRef.current) setQBusy(null)
      }
      return
    }

    try {
      const res = await fetch(`/api/campus/query/${kind}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ xnm: params.xnm || '', xqm: params.xqm || '' }),
      })
      const b = await res.json().catch(() => null)
      if (ep !== epochRef.current) return
      if (res.status === 503) {
        setUnavailable((b && b.detail) ? String(b.detail) : t('campusService.serverUnavailable'))
        return
      }
      if (!res.ok) {
        setErrMsg(b && b.detail ? String(b.detail) : t('campusService.error'))
        return
      }
      // auto_captcha_used：AI 自动识别验证码，直接展示结果
      if (b && b.auto_captcha_used) {
        if (b.data) applyResult(kind, b.data, true)
        return
      }
      if (b && b.need_captcha) {
        setCaptcha({
          kind,
          xnm: params.xnm || '',
          xqm: params.xqm || '',
          image: b.captcha_base64 || '',
          err: '',
          submitting: false,
        })
        setCapInput('')
        return
      }
      if (b && b.data) applyResult(kind, b.data)
    } catch {
      if (ep === epochRef.current) setErrMsg(t('campusService.error'))
    } finally {
      busyRef.current = false
      if (ep === epochRef.current) setQBusy(null)
    }
  }

  // ── 验证码提交 ──
  const submitCaptcha = async () => {
    const c = captcha
    if (!c || c.submitting || !capInput.trim()) return
    const ep = epochRef.current
    setCaptcha({ ...c, submitting: true, err: '' })
    try {
      const res = await fetch('/api/campus/login', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: c.kind, captcha: capInput.trim(), xnm: c.xnm, xqm: c.xqm }),
      })
      const b = await res.json().catch(() => null)
      if (ep !== epochRef.current) { setCaptcha(null); return }
      if (res.status === 503) {
        setCaptcha(null)
        setCapInput('')
        setUnavailable((b && b.detail) ? String(b.detail) : t('campusService.serverUnavailable'))
        return
      }
      if (!res.ok) {
        setCaptcha({ ...c, submitting: false, err: b && b.detail ? String(b.detail) : t('campusService.error') })
        return
      }
      setCaptcha(null)
      setCapInput('')
      if (b && b.data) applyResult(c.kind, b.data)
    } catch {
      setCaptcha({ ...c, submitting: false, err: t('campusService.error') })
    }
  }

  // ── 校园卡动态码自动刷新 ──
  useEffect(() => {
    if (!token || !status || status.status !== 'connected' || !ecardData || !ecardData.refresh) {
      setEcardCount(0)
      return
    }
    if (captcha) return
    let n = ecardData.refresh
    setEcardCount(n)
    const timer = setInterval(() => {
      n -= 1
      if (n <= 0) {
        n = ecardData.refresh
        doQuery('ecard')
      }
      setEcardCount(n)
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, status, ecardData, captcha])

  // 子页面进入时自动查询对应功能（有缓存时不自动查询，等用户点刷新）
  // 电费走公网 API 不依赖 VPN；其余三项需 VPN 隧道
  useEffect(() => {
    const canQuery = feature === 'electricity' ? true : connected
    if (isSubPage && canQuery && !qBusy && !captcha && cacheLoaded) {
      if (feature === 'score' && !scoreData) doQuery('score')
      else if (feature === 'grades' && !gradeData) doQuery('grades')
      else if (feature === 'ecard' && !ecardData) doQuery('ecard')
      else if (feature === 'electricity' && !elecData) doQuery('electricity')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubPage, feature, connected, cacheLoaded])

  const goFillCreds = () => {
    localStorage.setItem('my_tab', 'campus')
    navigate('/my')
  }

  const handleCopyProxy = (kind) => {
    if (!status || !status.host) return
    const port = kind === 'socks' ? status.socks_port : status.http_port
    const addr = `${status.host}:${port}`
    copyText(addr)
    setCopyLabel(kind)
    setTimeout(() => setCopyLabel(''), 1500)
  }

  // ── 渲染：状态卡（只读展示，连接由管理员在后台管理） ──
  const renderStatusCard = () => {
    if (unavailable) {
      return (
        <div className="cs-status-card cs-status-down">
          <div className="cs-status-row">
            <span className="cs-badge cs-badge-danger">{t('campusService.serverUnavailable')}</span>
            <button className="btn btn-secondary" onClick={fetchStatus}>{t('campusService.retry')}</button>
          </div>
          {unavailable && <p className="cs-status-err">{typeof unavailable === 'object' ? JSON.stringify(unavailable) : String(unavailable)}</p>}
        </div>
      )
    }
    if (!status) {
      return (
        <div className="cs-status-card">
          <span className="cs-badge cs-badge-muted">{t('campusService.loading')}</span>
        </div>
      )
    }
    const st = status.status
    const connected = st === 'connected'
    const inFlight = st === 'creating' || st === 'connecting'
    return (
      <div className="cs-status-card">
        <div className="cs-status-row">
          {connected ? (
            <span className="cs-badge cs-badge-ok">{t('campusService.connected')}</span>
          ) : inFlight ? (
            <span className="cs-badge cs-badge-busy">
              <span className="cs-spinner" />{t('campusService.connecting')}
            </span>
          ) : (
            <span className={`cs-badge ${st === 'failed' ? 'cs-badge-danger' : 'cs-badge-muted'}`}>
              {st === 'failed' ? t('campusService.failed') : t('campusService.notConnected')}
            </span>
          )}
          <button className="btn btn-secondary" onClick={fetchStatus} disabled={statusBusy}>
            {t('campusService.retry')}
          </button>
        </div>
        {st === 'failed' && status.error && <p className="cs-status-err">{status.error}</p>}
        {!connected && !inFlight && (
          <p className="cs-status-hint">{t('campusService.adminHint')}</p>
        )}
        {connected && status.host && (
          <div className="cs-proxy-info">
            <div className="cs-proxy-row">
              <span className="cs-proxy-label">{t('campusService.proxy.socks')}</span>
              <span className="cs-proxy-addr">{status.host}:{status.socks_port}</span>
              <button type="button" className="cs-proxy-copy" onClick={() => handleCopyProxy('socks')}>
                {copyLabel === 'socks' ? t('campusService.proxy.copied') : t('campusService.proxy.copy')}
              </button>
            </div>
            <div className="cs-proxy-row">
              <span className="cs-proxy-label">{t('campusService.proxy.http')}</span>
              <span className="cs-proxy-addr">{status.host}:{status.http_port}</span>
              <button type="button" className="cs-proxy-copy" onClick={() => handleCopyProxy('http')}>
                {copyLabel === 'http' ? t('campusService.proxy.copied') : t('campusService.proxy.copy')}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── 渲染：auto_captcha_used 提示 ──
  const renderAutoCaptchaBanner = () => {
    if (!autoCaptchaUsed) return null
    return (
      <div className="cs-auto-banner">
        {t('campusService.captcha.autoSolved')}
      </div>
    )
  }

  // ── 渲染：第二课堂分 ──
  const renderScore = () => {
    if (!scoreData) return null
    const total = scoreData.total
    if (total == null && !(scoreData.groups || []).length) {
      return <div className="cs-panel"><p className="cs-empty">{t('campusService.score.empty')}</p></div>
    }
    const student = scoreData.student || {}
    const infos = STUDENT_LABELS.filter(([k]) => student[k] != null && student[k] !== '')
    return (
      <div className="cs-panel">
        {infos.length > 0 && (
          <div className="cs-student-line">
            {infos.map(([k, labelKey], i) => (
              <span key={k}>
                {i > 0 && <em className="cs-sep">·</em>}
                {t(labelKey)} {student[k]}
              </span>
            ))}
          </div>
        )}
        <div className="cs-stats">
          <div className="cs-stat">
            <span className="cs-stat-label">{t('campusService.score.total')}</span>
            <b>{total != null ? total : '—'}</b>
          </div>
          <div className="cs-stat">
            <span className="cs-stat-label">{t('campusService.score.credit')}</span>
            <div className="cs-stat-row">
              <b className={scoreData.credit != null ? (scoreData.credit >= TOTAL_TARGET ? 'cs-score-ok' : 'cs-score-warn') : ''}>{scoreData.credit != null ? scoreData.credit : '—'}</b>
              {scoreData.credit != null && <span className="cs-stat-target">/ {TOTAL_TARGET}</span>}
            </div>
          </div>
        </div>
        <div className="cs-groups">
          {(scoreData.groups || []).map((g, gi) => {
            const target = matchScoreTarget(g.name)
            const actual = g.subtotal != null ? Number(g.subtotal) : null
            const targetVal = target ? target.target : null
            const reached = actual != null && targetVal != null && actual >= targetVal
            const noExpand = target && target.noExpand

            // 美育/健康教育：不展开，只显示总分
            if (noExpand) {
              return (
                <div key={gi} className="cs-group cs-group-flat">
                  <div className="cs-group-flat-row">
                    <span className="cs-group-name">{g.name}</span>
                    {g.subtotal != null && (
                      <span className={`cs-group-sub ${targetVal != null ? (reached ? 'cs-group-ok' : 'cs-group-warn') : ''}`}>
                        {actual} / {targetVal != null ? targetVal : '—'}
                      </span>
                    )}
                  </div>
                </div>
              )
            }

            // 德育/劳育：可展开，子项显示达标分
            return (
            <details key={gi} className="cs-group" open={gi < (scoreData.groups || []).length - 2 && g.rows.length <= 4}>
              <summary>
                <span className="cs-group-name">{g.name}</span>
                {g.subtotal != null && (
                  <span className={`cs-group-sub ${targetVal != null ? (reached ? 'cs-group-ok' : 'cs-group-warn') : ''}`}>
                    {actual} / {targetVal != null ? targetVal : '—'}
                  </span>
                )}
              </summary>
              <div className="cs-group-body">
                {g.rows.length === 0 ? (
                  <p className="cs-empty">{t('campusService.score.empty')}</p>
                ) : (
                  <table className="cs-mini-table">
                    <tbody>
                      {g.rows.map((r, ri) => {
                        const sub = matchSubTarget(r.name)
                        return (
                        <tr key={ri}>
                          <td>{r.name}</td>
                          {sub && sub.target != null ? (
                            <td className={`cs-mini-val ${Number(r.value) >= sub.target ? 'cs-sub-ok' : 'cs-sub-warn'}`}>
                              {r.value != null && r.value !== '' ? r.value : '—'} / {sub.target}
                            </td>
                          ) : (
                            <td className="cs-mini-val">{r.value != null && r.value !== '' ? r.value : '—'}</td>
                          )}
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </details>
          )})}
        </div>
      </div>
    )
  }

  // ── 渲染：成绩 ──
  const renderGrades = () => {
    if (!gradeData) return null
    const rows = gradeData.grades || []
    return (
      <div className="cs-panel">
        <div className="cs-grades-hero">
          <div className="cs-stat cs-gpa">
            <span className="cs-stat-label">{t('campusService.grades.gpa')}</span>
            <b>{gradeData.gpa != null ? Number(gradeData.gpa).toFixed(1) : '0'}</b>
          </div>
          <span className="cs-grade-count">{t('campusService.grades.count', { n: gradeData.count != null ? gradeData.count : rows.length })}</span>
          <div className="cs-term-select">
            <CategoryDropdown
              value={gradeTerm}
              onChange={handleTermChange}
              options={[{ value: '', label: t('campusService.grades.allTerms') }, ...gradeTerms.map(tm => ({ value: `${tm.xnm}|${tm.xqm}`, label: `${tm.xnmmc || tm.xnm} · ${tm.xqmmc || tm.xqm}` }))]}
              placeholder={t('campusService.grades.selectTerm')}
              size="sm"
              hideClear
              closeOnSelect
            />
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="cs-empty">{t('campusService.grades.empty')}</p>
        ) : (
          <div className="cs-table-wrap">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>{t('campusService.grades.col.course')}</th>
                  <th>{t('campusService.grades.col.score')}</th>
                  <th>{t('campusService.grades.col.credit')}</th>
                  <th>{t('campusService.grades.col.gpa')}</th>
                  <th>{t('campusService.grades.col.method')}</th>
                  <th>{t('campusService.grades.col.year')}</th>
                  <th>{t('campusService.grades.col.term')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g, i) => (
                  <tr key={i}>
                    <td className="cs-cell-course">{g.kcmc}</td>
                    <td>{g.cj != null && g.cj !== '' ? g.cj : '—'}</td>
                    <td>{g.xf != null && g.xf !== '' ? g.xf : '—'}</td>
                    <td>{g.jd != null && g.jd !== '' ? g.jd : '—'}</td>
                    <td>{g.khfsmc || '—'}</td>
                    <td>{g.xnmmc || '—'}</td>
                    <td>{g.xqmmc || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  const handleTermChange = (v) => {
    setGradeTerm(v)
    if (v) {
      const idx = v.indexOf('|')
      doQuery('grades', { xnm: v.slice(0, idx), xqm: v.slice(idx + 1) })
    } else {
      doQuery('grades', {})
    }
  }

  // ── 渲染：校园卡动态码 ──
  const renderEcard = () => {
    if (!ecardData) return null
    return (
      <div className="cs-panel cs-ecard-panel">
        <div className="cs-ecard-head">
          <div className="cs-ecard-title">
            <span className="cs-badge cs-badge-ok">{t('campusService.query.ecard')}</span>
            {ecardData.refresh > 0 && (
              <span className="cs-ecard-countdown">{t('campusService.ecard.countdown', { n: ecardCount })}</span>
            )}
          </div>
          <button className="btn btn-secondary" onClick={() => doQuery('ecard')} disabled={!!qBusy}>
            {qBusy === 'ecard' ? t('campusService.ecard.refreshing') : t('campusService.ecard.refresh')}
          </button>
        </div>
        {ecardData.image ? (
          <img className="cs-ecard-img" src={`data:${ecardData.type || 'image/png'};base64,${ecardData.image}`} alt="dynamic-code" />
        ) : ecardData.code ? (
          <p className="cs-ecard-code">{ecardData.code}</p>
        ) : null}
        <p className="cs-ecard-tip">{t('campusService.ecard.tip')}</p>
      </div>
    )
  }

  // ── 电费充值 ──
  const handleRecharge = async () => {
    const amt = parseFloat(rechargeAmt)
    if (!amt || amt <= 0 || amt > 500) {
      setRechargeMsg(t('campusService.electricity.rechargeRange'))
      return
    }
    setRechargeBusy(true)
    setRechargeMsg('')
    try {
      const res = await fetch('/api/campus/recharge', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        setRechargeMsg(b && b.detail ? String(b.detail) : t('campusService.electricity.rechargeFailed', { error: '' }))
        return
      }
      setRechargeMsg(t('campusService.electricity.rechargeSuccess'))
      setRechargeAmt('')
      // 更新余额
      if (b && b.data) {
        setElecData(prev => prev ? {
          ...prev,
          balance: b.data.balance ?? prev.balance,
          card_balance: b.data.card_balance ?? prev.card_balance,
        } : prev)
      }
      fetchElecHistory()
      setTimeout(() => { setRechargeOpen(false); setRechargeMsg('') }, 2000)
    } catch {
      setRechargeMsg(t('campusService.electricity.rechargeFailed', { error: '' }))
    } finally {
      setRechargeBusy(false)
    }
  }

  // ── 渲染：电费查询 ──
  const renderElectricity = () => {
    return (
      <div className="cs-panel cs-elec-panel">
        {elecData ? (
          <>
            <div className="cs-elec-head">
              <div className="cs-elec-stats">
                <div className="cs-stat">
                  <span className="cs-stat-label">{t('campusService.electricity.balance')}</span>
                  <b className={elecData.balance != null && elecData.balance < 10 ? 'cs-score-warn' : ''}>
                    {elecData.balance != null ? `¥${Number(elecData.balance).toFixed(2)}` : '—'}
                  </b>
                </div>
                <div className="cs-stat">
                  <span className="cs-stat-label">{t('campusService.electricity.cardBalance')}</span>
                  <b>{elecData.card_balance != null ? `¥${Number(elecData.card_balance).toFixed(2)}` : '—'}</b>
                </div>
              </div>
              <div className="cs-elec-btns">
                <button className="btn btn-primary" onClick={() => { setRechargeOpen(true); setRechargeMsg(''); setRechargeAmt('') }}>
                  {t('campusService.electricity.recharge')}
                </button>
                <button className="btn btn-secondary" onClick={() => doQuery('electricity')} disabled={!!qBusy}>
                  {qBusy === 'electricity' ? t('campusService.refreshing') : t('campusService.refresh')}
                </button>
              </div>
            </div>
            <p className="cs-elec-dorm">{elecData.dorm}</p>
          </>
        ) : (
          <div className="cs-elec-empty">
            <p className="cs-empty">{t('campusService.electricity.empty')}</p>
            <button className="btn btn-primary" onClick={() => doQuery('electricity')} disabled={!!qBusy}>
              {qBusy === 'electricity' ? t('campusService.refreshing') : t('campusService.refresh')}
            </button>
          </div>
        )}

        {/* 历史折线图 */}
        {elecHistory.length > 0 && (
          <div className="cs-elec-chart">
            <div className="cs-elec-chart-head">
              <span className="cs-elec-chart-title">{t('campusService.electricity.history')}</span>
              <div className="cs-elec-view-btns">
                {['day', 'week', 'month'].map(v => (
                  <button
                    key={v}
                    className={`cs-elec-view-btn ${elecView === v ? 'active' : ''}`}
                    onClick={() => setElecView(v)}
                  >
                    {t(`campusService.electricity.view${v.charAt(0).toUpperCase() + v.slice(1)}`)}
                  </button>
                ))}
              </div>
            </div>
            <MiniLineChart data={elecHistory} view={elecView} />
          </div>
        )}
        <p className="cs-elec-auto">{t('campusService.electricity.autoQueried')}</p>
      </div>
    )
  }

  // ── 充值弹窗 ──
  const renderRechargeModal = () => {
    if (!rechargeOpen) return null
    return (
      <Modal
        open
        title={t('campusService.electricity.rechargeTitle')}
        confirmText={t('campusService.electricity.rechargeConfirm')}
        cancelText={t('modal.cancel')}
        confirmDisabled={rechargeBusy || !rechargeAmt}
        onConfirm={handleRecharge}
        onCancel={() => { setRechargeOpen(false); setRechargeMsg('') }}
      >
        <div className="cs-recharge">
          <div className="cs-recharge-current">
            {t('campusService.electricity.balance')}：
            <b>{elecData && elecData.balance != null ? `¥${Number(elecData.balance).toFixed(2)}` : '—'}</b>
          </div>
          <div className="ccp-field">
            <label className="ccp-label">{t('campusService.electricity.rechargeAmount')}</label>
            <input
              className="ccp-input"
              type="number"
              min="0.01"
              max="500"
              step="0.01"
              value={rechargeAmt}
              placeholder={t('campusService.electricity.rechargePlaceholder')}
              autoFocus
              onChange={e => setRechargeAmt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRecharge() }}
            />
          </div>
          {rechargeMsg && (
            <p className={`cs-recharge-msg ${rechargeMsg.includes('成功') ? 'ok' : 'err'}`}>
              {rechargeMsg}
            </p>
          )}
        </div>
      </Modal>
    )
  }

  // ── 渲染：验证码弹窗 ──
  const renderCaptchaModal = () => {
    if (!captcha) return null
    return (
      <Modal
        open
        title={t('campusService.captcha.title')}
        confirmText={t('campusService.captcha.confirm')}
        cancelText={t('modal.cancel')}
        confirmDisabled={captcha.submitting || !capInput.trim()}
        onConfirm={submitCaptcha}
        onCancel={() => { setCaptcha(null); setCapInput('') }}
      >
        <div className="cs-captcha">
          <p className="cs-captcha-prompt">{t('campusService.captcha.prompt')}</p>
          <div className="cs-captcha-row">
            {captcha.image ? (
              <img className="cs-captcha-img" src={`data:image/png;base64,${captcha.image}`} alt="captcha" />
            ) : (
              <span className="cs-captcha-noimg">{t('campusService.captcha.noImage')}</span>
            )}
            <input
              className="tool-input cs-captcha-input"
              placeholder={t('campusService.captcha.placeholder')}
              value={capInput}
              maxLength={10}
              autoFocus
              onChange={e => setCapInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitCaptcha() }}
            />
          </div>
          {captcha.err && <p className="cs-captcha-err">{captcha.err}</p>}
          <button type="button" className="btn btn-secondary" onClick={() => doQuery(captcha.kind, { xnm: captcha.xnm, xqm: captcha.xqm })} disabled={captcha.submitting}>
            {t('campusService.captcha.refetch')}
          </button>
        </div>
      </Modal>
    )
  }

  // ── 主页渲染 ──
  const renderMainPage = () => {
    // 电费走校付宝公网 API，不依赖 VPN；其余三项需要 VPN 隧道
    const cards = [
      { path: 'score', name: 'campusService.query.score', desc: 'campusService.query.scoreDesc', needVpn: true },
      { path: 'grades', name: 'campusService.query.grades', desc: 'campusService.query.gradesDesc', needVpn: true },
      { path: 'ecard', name: 'campusService.query.ecard', desc: 'campusService.query.ecardDesc', needVpn: true },
      { path: 'electricity', name: 'campusService.electricity.name', desc: 'campusService.electricity.desc', needVpn: false },
    ]
    return (
      <>
        {token && renderStatusCard()}

        {token && (
          <>
            <h2 className="cs-queries-title">{t('campusService.queriesTitle')}</h2>
            <div className="cs-queries">
              {cards.map(c => {
                const locked = c.needVpn && !connected
                return (
                  <Link
                    key={c.path}
                    to={`/tools/campus-service/${c.path}`}
                    className={`cs-qcard ${locked ? 'cs-qcard-locked' : ''}`}
                  >
                    <span className="cs-qcard-name">{t(c.name)}</span>
                    <span className="cs-qcard-desc">{t(c.desc)}</span>
                    <span className="cs-qcard-state">
                      {locked ? t('campusService.needVpn') : '›'}
                    </span>
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </>
    )
  }

  // ── 子页面渲染 ──
  const renderSubPage = () => (
    <>
      <Link to="/tools/campus-service" className="tool-back">{t('campusService.backToCampus')}</Link>
      <div className="cs-sub-header">
        <h2 className="cs-sub-title">{t(KIND_LABELS[feature])}</h2>
        {feature !== 'ecard' && (
          <button
            className="btn btn-secondary cs-refresh-btn"
            onClick={() => doQuery(feature)}
            disabled={!!qBusy}
          >
            {qBusy === feature ? t('campusService.refreshing') : t('campusService.refresh')}
          </button>
        )}
      </div>

      {/* 电费走公网 API，不依赖 VPN，故不展示连接状态卡 */}
      {token && feature !== 'electricity' && renderStatusCard()}

      {token && (connected || feature === 'electricity') && (
        <>
          {renderAutoCaptchaBanner()}
          {feature === 'score' && renderScore()}
          {feature === 'grades' && renderGrades()}
          {feature === 'ecard' && renderEcard()}
          {feature === 'electricity' && renderElectricity()}
        </>
      )}

      {token && feature !== 'electricity' && !connected && (
        <div className="cs-panel">
          <p className="cs-empty">{t('campusService.vpnRequired')}</p>
        </div>
      )}
    </>
  )

  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main">
        <header className="tool-header">
          <Link to="/tools" className="tool-back">{t('campusService.backToTools')}</Link>
          <h1 className="tool-title">{t('campusService.title')}</h1>
          <p className="tool-subtitle">{t('campusService.subtitle')}</p>
        </header>

        {!token && (
          <div className="tool-login-hint">
            {t('campusService.needLogin')}<Link to="/auth">{t('campusService.goAuth')}</Link>
          </div>
        )}

        {credBanner && (
          <div className="cs-banner">
            <div className="cs-banner-main">
              <p className="cs-banner-title">{t('campusService.notConfigured')}</p>
              <p className="cs-banner-hint">{t('campusService.notConfiguredHint')}</p>
            </div>
            <button className="btn btn-primary" onClick={goFillCreds}>{t('campusService.goFill')}</button>
          </div>
        )}

        {errMsg && <div className="tool-error">{typeof errMsg === 'object' ? JSON.stringify(errMsg) : String(errMsg)}</div>}

        {isSubPage ? renderSubPage() : renderMainPage()}
      </div>

      {renderCaptchaModal()}
      {renderRechargeModal()}
    </div>
  )
}
