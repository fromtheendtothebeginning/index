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

// 第二课堂达标分数（2025 级）
const TOTAL_TARGET = 8
// 一级板块达标：美育 / 健康教育只看总分，不展开
const SCORE_TARGETS = [
  { keywords: ['德育'], target: 3.0 },
  { keywords: ['劳育'], target: 3.0 },
  { keywords: ['美育'], target: 1.0, noExpand: true },
  { keywords: ['健康'], target: 1.0, noExpand: true },
]
// 二级板块达标（仅德育 / 劳育有）
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

// ── 电费历史曲线：按视图聚合成点 ──
const DAY_MS = 86400000
const DAY_POINTS = 30 // 日视图：近 30 天每条记录一个点
const BUCKET_LIMIT = 12 // 周 / 月视图：最多展示最近 12 个桶

// ISO 周键（周一为一周起点），如 2026-W36
function isoWeekKey(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = dt.getUTCDay() || 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((dt - yearStart) / DAY_MS + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 日 = 近 30 天逐条记录；周 = 按 ISO 周取均值；月 = 按自然月取均值
// remain / balance 都为空的记录（充值后复查余额失败）跳过，避免被当成 0 拉低曲线
function buildSeries(records, view) {
  const points = (records || [])
    .filter(r => r && r.time && (r.remain != null || r.balance != null))
    .map(r => ({ dt: new Date(r.time), v: Number(r.remain != null ? r.remain : r.balance) }))
    .filter(p => !Number.isNaN(p.dt.getTime()) && Number.isFinite(p.v))
    .sort((a, b) => a.dt - b.dt)
  if (points.length === 0) return []

  if (view === 'day') {
    const cutoff = Date.now() - DAY_POINTS * DAY_MS
    return points
      .filter(p => p.dt.getTime() >= cutoff)
      .map(p => ({ label: `${p.dt.getMonth() + 1}/${p.dt.getDate()}`, v: p.v }))
  }

  const keyOf = view === 'week' ? isoWeekKey : monthKey
  const buckets = new Map()
  for (const p of points) {
    const k = keyOf(p.dt)
    const b = buckets.get(k) || { first: p.dt, sum: 0, n: 0 }
    b.sum += p.v
    b.n += 1
    buckets.set(k, b)
  }
  return [...buckets.entries()].slice(-BUCKET_LIMIT).map(([k, b]) => ({
    label: view === 'week' ? `${b.first.getMonth() + 1}/${b.first.getDate()}` : k,
    v: b.sum / b.n,
  }))
}

// ── 周期平均每天耗电（本周 / 本月） ──
// 周期起点用本地时间：本周 = 本周一 00:00:00；本月 = 本月 1 日 00:00:00
function periodStart(view) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (view === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // 周一为一周起点
  else d.setDate(1)
  return d.getTime()
}

// 耗电 = (首条余额 - 末条余额) + 首条之后所有记录的充值额（充值让余额变大，不算消耗）
// balance 为空的记录不参与首末条，但其充值额仍计入；周期内有效记录不足 2 条返回 null
function avgDailyUsage(records, view) {
  const start = periodStart(view)
  const pts = (records || [])
    .filter(r => r && r.time)
    .map(r => ({
      ts: new Date(r.time).getTime(),
      balance: r.balance != null ? Number(r.balance) : null,
      recharge: Number(r.recharge) || 0,
    }))
    .filter(p => Number.isFinite(p.ts) && p.ts >= start)
    .sort((a, b) => a.ts - b.ts)

  const valid = pts.filter(p => p.balance != null && Number.isFinite(p.balance))
  if (valid.length < 2) return null

  // 耗电按相邻两个「有效余额点」之间的余额变化累计，并把区间内的充值额算进来：
  //   下降段：耗电 = 下降幅度 + 区间充值（充值花掉的也要算）
  //   上升段：耗电 = 充值额 - 上升幅度（被充值掩盖的净耗电）；充值额未知（学校 App 充的）时按 0 计
  // 这样无论充值有没有被本工具记录到，都不会把充值当成"负耗电"。
  let used = 0
  let prev = null
  let pending = 0 // 上一个有效余额点之后（含本条自己）尚未结算的充值额
  for (const p of pts) {
    pending += p.recharge
    if (p.balance == null) continue
    if (prev != null) {
      const delta = prev.balance - p.balance
      used += delta > 0 ? delta + pending : Math.max(0, pending + delta)
    }
    pending = 0
    prev = p
  }
  const days = Math.max(1, (valid[valid.length - 1].ts - valid[0].ts) / DAY_MS) // 不足一天算 1 天
  return used / days
}

// ── 简易 SVG 折线图 ──
function MiniLineChart({ data, view }) {
  const series = buildSeries(data, view)
  // 减弱动效偏好：不做入场动画，直接显示最终状态
  const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (series.length === 0) return null

  const W = 560, H = 180, PAD = { t: 20, r: 20, b: 30, l: 50 }
  const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b

  const vals = series.map(s => s.v)
  const minV = Math.min(...vals), maxV = Math.max(...vals)
  const range = maxV - minV || 1

  const points = series.map((s, i) => ({
    x: PAD.l + (i / Math.max(series.length - 1, 1)) * cw,
    y: PAD.t + ch - ((s.v - minV) / range) * ch,
    label: s.label,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

  // Y 轴刻度（4 条）
  const yTicks = [0, 0.33, 0.67, 1].map(f => ({
    v: Math.round((minV + f * range) * 10) / 10,
    y: PAD.t + ch - f * ch,
  }))

  // X 轴标签（均匀取样，始终保留最后一个点）
  const step = Math.max(1, Math.floor(points.length / 5))
  const xLabels = points.filter((_, i) => i % step === 0 || i === points.length - 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cs-elec-svg" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((tk, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={tk.y} x2={W - PAD.r} y2={tk.y} stroke="var(--border-color)" strokeDasharray="3,3" />
          <text x={PAD.l - 6} y={tk.y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{tk.v}</text>
        </g>
      ))}
      {xLabels.map((p, i) => (
        <text key={i} x={p.x} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{p.label}</text>
      ))}
      {/* pathLength=1：用 CSS 的 dasharray/dashoffset 做自绘动画，无需测量真实路径长度 */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--accent-1)"
        strokeWidth="2"
        strokeLinejoin="round"
        pathLength={reduceMotion ? undefined : 1}
        className={reduceMotion ? undefined : 'cs-elec-line'}
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="3"
          fill="var(--accent-1)"
          className={reduceMotion ? undefined : 'cs-elec-dot'}
          style={reduceMotion ? undefined : { animationDelay: `${Math.round((i / Math.max(points.length - 1, 1)) * 350)}ms` }}
        />
      ))}
    </svg>
  )
}

// 减弱动效偏好（判定同 MiniLineChart）：为真时 toast 不做入场动画
function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

// ── 上次查询结果缓存（localStorage，按用户隔离） ──
function currentUserId() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').id
  } catch {
    return null
  }
}

function _cacheKey(feature, userId) {
  return `campus_cache_${feature}_${userId || 'anon'}`
}

function loadCache(feature, userId) {
  try {
    const raw = localStorage.getItem(_cacheKey(feature, userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveCache(feature, userId, data) {
  try {
    localStorage.setItem(_cacheKey(feature, userId), JSON.stringify(data))
  } catch { /* 忽略 */ }
}

// ── 实践学分：数字增长动画（0 → 终值，约 700ms 缓出；值变化时重播）──
function CountUp({ value, duration = 700 }) {
  const raw = value != null ? value : '—'
  const target = Number(value)
  const [progress, setProgress] = useState(
    () => (Number.isFinite(target) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1)
  )

  useEffect(() => {
    if (!Number.isFinite(target) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1)
      return
    }
    setProgress(0)
    let raf = 0
    const t0 = performance.now()
    const tick = now => {
      const p = Math.max(0, Math.min(1, (now - t0) / duration)) // rAF 时间戳可能早于 t0，需夹紧
      setProgress(p)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  if (!Number.isFinite(target) || progress >= 1) return raw
  return (target * (1 - Math.pow(1 - progress, 3))).toFixed(1)
}

// ── 第二课堂分组：受控手风琴（展开状态各自独立，动画见 .cs-group-body）──
function ScoreGroup({ group, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const target = matchScoreTarget(group.name)
  const actual = group.subtotal != null ? Number(group.subtotal) : null
  const targetVal = target ? target.target : null
  const reached = actual != null && targetVal != null && actual >= targetVal
  const subCls = targetVal != null ? (reached ? 'cs-group-ok' : 'cs-group-warn') : ''
  return (
    <div className={`cs-group${open ? ' is-open' : ''}`}>
      <button type="button" className="cs-group-summary" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="cs-group-name">{group.name}</span>
        {group.subtotal != null && (
          <span className={`cs-group-sub ${subCls}`}>{actual} / {targetVal != null ? targetVal : '—'}</span>
        )}
      </button>
      <div className={`cs-group-body${open ? ' is-open' : ''}`}>
        <div className="cs-group-body-inner">
          {group.rows.length === 0 ? (
            <p className="cs-empty">{t('campusService.score.empty')}</p>
          ) : (
            <table className="cs-mini-table">
              <tbody>
                {group.rows.map((r, ri) => {
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
      </div>
    </div>
  )
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
  const [cacheFeature, setCacheFeature] = useState('') // 已恢复过缓存的子页面

  // ── 电费 ──
  const [elecData, setElecData] = useState(null)
  const [elecHistory, setElecHistory] = useState([])
  const [elecHistSeq, setElecHistSeq] = useState(0) // 每次拿到新历史数据 +1（折线图入场动画的重播信号）
  const [elecView, setElecView] = useState('day') // day | week | month
  const [rechargeOpen, setRechargeOpen] = useState(false)
  const [rechargeAmt, setRechargeAmt] = useState('')
  const [rechargeBusy, setRechargeBusy] = useState(false)
  const [rechargeMsg, setRechargeMsg] = useState('')
  const [rechargeToast, setRechargeToast] = useState('') // 充值成功后的页面级提示
  const toastTimerRef = useRef(null)

  // ── 验证码两段式 ──
  const [captcha, setCaptcha] = useState(null)
  const [capInput, setCapInput] = useState('')
  const [autoCaptchaUsed, setAutoCaptchaUsed] = useState(false)

  // 派生状态（useEffect 依赖用，必须在 useEffect 之前声明）
  const connected = !!(status && !unavailable && status.status === 'connected')

  // 请求竞态防护
  const epochRef = useRef(0)
  const busyRef = useRef(false)

  // 页面级 toast：显示 3 秒后自动消失；新提示覆盖旧提示或组件卸载时清掉上一个计时器
  const showToast = useCallback((msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setRechargeToast(msg)
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null
      setRechargeToast('')
    }, 3000)
  }, [])

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }, [])

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

  useEffect(() => {
    if (!token) return
    fetchStatus()
  }, [token, fetchStatus])

  const shouldPoll = !!(status && !unavailable && (status.status === 'creating' || status.status === 'connecting'))
  useEffect(() => {
    if (!token || !shouldPoll) return
    const timer = setInterval(fetchStatus, 3000)
    return () => clearInterval(timer)
  }, [token, shouldPoll, unavailable, fetchStatus])

  // ── 电费历史（电费走公网接口，不依赖 VPN 隧道） ──
  const fetchElecHistory = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/campus/electricity/history?days=90', { headers: authHeaders() })
      if (!res.ok) return
      const b = await res.json().catch(() => null)
      if (b && Array.isArray(b.records)) {
        setElecHistory(b.records)
        setElecHistSeq(s => s + 1)
      }
    } catch { /* 忽略 */ }
  }, [token, authHeaders])

  // ── 子页面进入时先用上次查询结果渲染（缓存带用户 id，互不串数据） ──
  useEffect(() => {
    if (!token || !isSubPage || cacheFeature === feature) return
    const userId = currentUserId()
    if (feature === 'score') {
      const c = loadCache('score', userId)
      if (c) setScoreData(c)
    } else if (feature === 'grades') {
      const c = loadCache('grades', userId)
      if (c) {
        setGradeData(c)
        if (Array.isArray(c.terms) && c.terms.length > 0) setGradeTerms(c.terms)
      }
    }
    // 校园卡动态码 / 电费不做缓存
    setCacheFeature(feature)
  }, [token, isSubPage, feature, cacheFeature])

  // 电费子页面进入时拉取历史曲线
  useEffect(() => {
    if (isSubPage && feature === 'electricity') fetchElecHistory()
  }, [isSubPage, feature, fetchElecHistory])

  // ── 连接 / 断开 ──
  const handleConnect = async () => {
    if (!token || statusBusy || busyRef.current) return
    const ep = epochRef.current
    setStatusBusy(true)
    setErrMsg('')
    setCredBanner(false)
    try {
      const res = await fetch('/api/campus/connect', { method: 'POST', headers: authHeaders() })
      const b = await res.json().catch(() => null)
      if (ep !== epochRef.current) return
      if (res.status === 503) {
        setUnavailable((b && b.detail) ? String(b.detail) : t('campusService.serverUnavailable'))
        return
      }
      if (!res.ok) {
        setCredBanner(true)
        return
      }
      setStatus(b)
      setUnavailable('')
    } catch {
      if (ep === epochRef.current) setErrMsg(t('campusService.error'))
    } finally {
      setStatusBusy(false)
    }
  }

  const handleDisconnect = async () => {
    if (!token || statusBusy || busyRef.current) return
    setStatusBusy(true)
    try {
      await fetch('/api/campus/disconnect', { method: 'POST', headers: authHeaders() })
    } catch { /* 忽略 */ }
    epochRef.current += 1
    setStatusBusy(false)
    setQBusy(null)
    setScoreData(null)
    setGradeData(null)
    setGradeTerms([])
    setGradeTerm('')
    setEcardData(null)
    setEcardCount(0)
    setCaptcha(null)
    setCapInput('')
    setErrMsg('')
    setAutoCaptchaUsed(false)
    fetchStatus()
    // 断开后回到主页
    if (isSubPage) navigate('/tools/campus-service')
  }

  // ── 结果写入 ──
  const applyResult = (kind, data, autoCaptcha) => {
    if (autoCaptcha) setAutoCaptchaUsed(true)
    const userId = currentUserId()
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

    // 电费走独立端点（不经过 query/{kind}，也不需要 VPN 隧道）
    if (kind === 'electricity') {
      try {
        const res = await fetch('/api/campus/electricity/query', {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: '{}',
        })
        const b = await res.json().catch(() => null)
        if (ep !== epochRef.current) return
        if (!res.ok) {
          setErrMsg((b && b.detail) ? String(b.detail) : t('campusService.error'))
          return
        }
        if (b && b.data) applyResult('electricity', b.data)
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

  // 子页面进入时自动查询（有缓存则先展示缓存，等用户点「刷新」）
  // 电费走公网接口不依赖 VPN，其余三项需 VPN 隧道
  useEffect(() => {
    const canQuery = feature === 'electricity' || connected
    if (isSubPage && canQuery && cacheFeature === feature && !qBusy && !captcha) {
      if (feature === 'score' && !scoreData) doQuery('score')
      else if (feature === 'grades' && !gradeData) doQuery('grades')
      else if (feature === 'ecard' && !ecardData) doQuery('ecard')
      else if (feature === 'electricity' && !elecData) doQuery('electricity')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubPage, feature, connected, cacheFeature])

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

  // ── 渲染：状态卡（仅主页展示，含连接 / 断开操作） ──
  const renderStatusCard = () => {
    if (unavailable) {
      return (
        <div className="cs-status-card cs-status-down">
          <div className="cs-status-row">
            <span className="cs-badge cs-badge-danger">{t('campusService.serverUnavailable')}</span>
            <button className="btn btn-secondary" onClick={fetchStatus}>{t('campusService.retry')}</button>
          </div>
          {unavailable && <p className="cs-status-err">{unavailable}</p>}
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
            <>
              <span className="cs-badge cs-badge-ok">{t('campusService.connected')}</span>
              {status.student_id_masked && <span className="cs-status-sid">{t('campusService.studentId', { sid: status.student_id_masked })}</span>}
              <button className="btn btn-secondary" onClick={handleDisconnect} disabled={statusBusy || !!qBusy}>
                {statusBusy ? t('campusService.disconnecting') : t('campusService.disconnect')}
              </button>
            </>
          ) : inFlight ? (
            <>
              <span className="cs-badge cs-badge-busy">
                <span className="cs-spinner" />{t('campusService.connecting')}
              </span>
            </>
          ) : (
            <>
              <span className={`cs-badge ${st === 'failed' ? 'cs-badge-danger' : 'cs-badge-muted'}`}>{st === 'failed' ? t('campusService.failed') : t('campusService.notConnected')}</span>
              <button className="btn btn-primary" onClick={handleConnect} disabled={statusBusy || !!qBusy}>
                {statusBusy ? t('campusService.connecting') : t('campusService.connect')}
              </button>
            </>
          )}
        </div>
        {st === 'failed' && status.error && <p className="cs-status-err">{status.error}</p>}
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
              <b className={scoreData.credit != null ? (Number(scoreData.credit) >= TOTAL_TARGET ? 'cs-score-ok' : 'cs-score-warn') : ''}>
                <CountUp value={scoreData.credit} />
              </b>
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
            const subCls = targetVal != null ? (reached ? 'cs-group-ok' : 'cs-group-warn') : ''

            // 美育 / 健康教育：只看总分，不展开
            if (target && target.noExpand) {
              return (
                <div key={gi} className="cs-group cs-group-flat">
                  <div className="cs-group-flat-row">
                    <span className="cs-group-name">{g.name}</span>
                    {g.subtotal != null && (
                      <span className={`cs-group-sub ${subCls}`}>{actual} / {targetVal != null ? targetVal : '—'}</span>
                    )}
                  </div>
                </div>
              )
            }

            // 德育 / 劳育：可展开，二级项显示达标分
            return (
              <ScoreGroup
                key={gi}
                group={g}
                defaultOpen={gi < (scoreData.groups || []).length - 2 && g.rows.length <= 4}
              />
            )
          })}
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
      const res = await fetch('/api/campus/electricity/recharge', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        // 失败不关弹窗，保留金额与错误信息
        setRechargeMsg(t('campusService.electricity.rechargeFailed', {
          error: (b && b.detail) ? String(b.detail) : t('campusService.error'),
        }))
        return
      }
      // 成功即关弹窗并清空弹窗内状态，改用页面级 toast 反馈
      setRechargeOpen(false)
      setRechargeMsg('')
      setRechargeAmt('')
      showToast(t('campusService.electricity.rechargeSuccess'))
      // 用返回的新余额就地更新面板，并刷新历史曲线
      if (b && b.data) {
        setElecData(prev => (prev ? {
          ...prev,
          balance: b.data.balance != null ? b.data.balance : prev.balance,
          card_balance: b.data.card_balance != null ? b.data.card_balance : prev.card_balance,
        } : prev))
      }
      fetchElecHistory()
    } catch {
      setRechargeMsg(t('campusService.electricity.rechargeFailed', { error: t('campusService.error') }))
    } finally {
      setRechargeBusy(false)
    }
  }

  // ── 渲染：电费查询 ──
  const renderElectricity = () => {
    const avgs = [
      ['campusService.electricity.avgWeek', avgDailyUsage(elecHistory, 'week')],
      ['campusService.electricity.avgMonth', avgDailyUsage(elecHistory, 'month')],
    ]
    return (
    <div className="cs-panel cs-elec-panel">
      {elecData ? (
        <>
          <div className="cs-elec-head">
            <div className="cs-elec-stats">
              <div className="cs-stat">
                <span className="cs-stat-label">{t('campusService.electricity.balance')}</span>
                <b className={elecData.balance != null && Number(elecData.balance) < 10 ? 'cs-score-warn' : ''}>
                  {elecData.balance != null ? `¥${Number(elecData.balance).toFixed(2)}` : '—'}
                </b>
              </div>
              <div className="cs-stat">
                <span className="cs-stat-label">{t('campusService.electricity.cardBalance')}</span>
                <b>{elecData.card_balance != null ? `¥${Number(elecData.card_balance).toFixed(2)}` : '—'}</b>
              </div>
            </div>
            <div className="cs-elec-btns">
              <button
                className="btn btn-primary"
                onClick={() => { setRechargeOpen(true); setRechargeMsg(''); setRechargeAmt('') }}
              >
                {t('campusService.electricity.recharge')}
              </button>
              <button className="btn btn-secondary" onClick={() => doQuery('electricity')} disabled={!!qBusy}>
                {qBusy === 'electricity' ? t('campusService.refreshing') : t('campusService.refresh')}
              </button>
            </div>
          </div>
          <p className="cs-elec-dorm">{elecData.dorm || t('campusService.electricity.noDorm')}</p>
        </>
      ) : (
        <div className="cs-elec-empty">
          <p className="cs-empty">{t('campusService.electricity.empty')}</p>
          <button className="btn btn-primary" onClick={() => doQuery('electricity')} disabled={!!qBusy}>
            {qBusy === 'electricity' ? t('campusService.refreshing') : t('campusService.refresh')}
          </button>
        </div>
      )}

      {/* 本周 / 本月平均每天耗电：只依赖历史记录（已剔除充值额），与本次查询是否成功无关 */}
      {elecHistory.length > 0 && (
        <div className="cs-elec-avgs">
          {avgs.map(([labelKey, v]) => (
            <span key={labelKey} className="cs-elec-avg" title={v == null ? t('campusService.electricity.avgInsufficient') : undefined}>
              <span className="cs-elec-avg-label">{t(labelKey)}</span>
              <b>{v != null ? `${v.toFixed(2)} ${t('campusService.electricity.avgUnit')}` : '—'}</b>
            </span>
          ))}
        </div>
      )}

      {/* 历史用量折线图 */}
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
          {/* key 随视图/新数据变化 → 组件重挂载，重放入场动画（切换视图、刷新拿到新数据都会重播） */}
          <MiniLineChart key={`${elecView}-${elecHistSeq}`} data={elecHistory} view={elecView} />
        </div>
      )}
      <p className="cs-elec-auto">{t('campusService.electricity.autoQueried')}</p>
    </div>
    )
  }

  // ── 渲染：充值弹窗 ──
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
            <p className="cs-recharge-msg err">{rechargeMsg}</p>
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

  // ── 主页渲染（电费不依赖 VPN，登录后即可进入） ──
  const renderMainPage = () => (
    <>
      {token && renderStatusCard()}

      {token && (
        <>
          <h2 className="cs-queries-title">{t('campusService.queriesTitle')}</h2>
          <div className={`cs-queries ${connected ? '' : 'cs-queries-single'}`}>
            {connected && (
              <>
                <Link to="/tools/campus-service/score" className="cs-qcard">
                  <span className="cs-qcard-name">{t('campusService.query.score')}</span>
                  <span className="cs-qcard-desc">{t('campusService.query.scoreDesc')}</span>
                  <span className="cs-qcard-state">{'›'}</span>
                </Link>
                <Link to="/tools/campus-service/grades" className="cs-qcard">
                  <span className="cs-qcard-name">{t('campusService.query.grades')}</span>
                  <span className="cs-qcard-desc">{t('campusService.query.gradesDesc')}</span>
                  <span className="cs-qcard-state">{'›'}</span>
                </Link>
                <Link to="/tools/campus-service/ecard" className="cs-qcard">
                  <span className="cs-qcard-name">{t('campusService.query.ecard')}</span>
                  <span className="cs-qcard-desc">{t('campusService.query.ecardDesc')}</span>
                  <span className="cs-qcard-state">{'›'}</span>
                </Link>
              </>
            )}
            <Link to="/tools/campus-service/electricity" className="cs-qcard">
              <span className="cs-qcard-name">{t('campusService.electricity.name')}</span>
              <span className="cs-qcard-desc">{t('campusService.electricity.desc')}</span>
              <span className="cs-qcard-state">{'›'}</span>
            </Link>
          </div>
        </>
      )}
    </>
  )

  // ── 子页面渲染（不展示状态卡 / 代理地址，未连接时只给一行提示） ──
  const needsVpn = feature !== 'electricity'
  const renderSubPage = () => (
    <>
      <Link to="/tools/campus-service" className="tool-back">{t('campusService.backToCampus')}</Link>
      <div className="cs-sub-header">
        <h2 className="cs-sub-title">{t(KIND_LABELS[feature])}</h2>
        {(feature === 'score' || feature === 'grades') && (
          <button className="btn btn-secondary cs-refresh-btn" onClick={() => doQuery(feature)} disabled={!!qBusy}>
            {qBusy === feature ? t('campusService.refreshing') : t('campusService.refresh')}
          </button>
        )}
      </div>

      {token && needsVpn && !connected && (
        <p className="cs-vpn-hint">
          {unavailable || t('campusService.vpnHint')}
          <Link to="/tools/campus-service" className="cs-vpn-hint-link">{t('campusService.goConnect')}</Link>
        </p>
      )}

      {token && (connected || !needsVpn) && (
        <>
          {renderAutoCaptchaBanner()}
          {feature === 'score' && renderScore()}
          {feature === 'grades' && renderGrades()}
          {feature === 'ecard' && renderEcard()}
          {feature === 'electricity' && renderElectricity()}
        </>
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

        {errMsg && <div className="tool-error">{errMsg}</div>}

        {isSubPage ? renderSubPage() : renderMainPage()}
      </div>

      {renderCaptchaModal()}
      {renderRechargeModal()}

      {/* 页面级 toast：固定视口居中，不受页面布局影响 */}
      {rechargeToast && (
        <div className={`cs-toast${prefersReducedMotion() ? '' : ' cs-toast-in'}`} role="status" aria-live="polite">
          <span className="cs-toast-check" aria-hidden="true">&#10003;</span>
          <span>{rechargeToast}</span>
        </div>
      )}
    </div>
  )
}
