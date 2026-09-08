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

const VALID_FEATURES = ['score', 'grades', 'ecard']

const KIND_LABELS = {
  score: 'campusService.query.score',
  grades: 'campusService.query.grades',
  ecard: 'campusService.query.ecard',
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
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

  // ── 验证码两段式 ──
  const [captcha, setCaptcha] = useState(null)
  const [capInput, setCapInput] = useState('')
  const [autoCaptchaUsed, setAutoCaptchaUsed] = useState(false)

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
    if (kind === 'score') {
      setScoreData((data && data.score) || data || null)
    } else if (kind === 'grades') {
      setGradeData(data || null)
      if (data && Array.isArray(data.terms) && data.terms.length > 0) {
        setGradeTerms(data.terms)
        setGradeTerm('')
      }
    } else if (kind === 'ecard') {
      setEcardData(data || null)
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

  // 子页面进入时自动查询对应功能
  useEffect(() => {
    if (isSubPage && connected && !qBusy && !captcha) {
      // 仅在对应数据为空时自动查询
      if (feature === 'score' && !scoreData) doQuery('score')
      else if (feature === 'grades' && !gradeData) doQuery('grades')
      else if (feature === 'ecard' && !ecardData) doQuery('ecard')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubPage, feature, connected])

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

  // ── 渲染：状态卡 ──
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
            <b>{scoreData.credit != null ? scoreData.credit : '—'}</b>
          </div>
        </div>
        <div className="cs-groups">
          {(scoreData.groups || []).map((g, gi) => (
            <details key={gi} className="cs-group" open={g.rows.length <= 4}>
              <summary>
                <span className="cs-group-name">{g.name}</span>
                {g.subtotal != null && <span className="cs-group-sub">{t('campusService.score.group')} {g.subtotal}</span>}
              </summary>
              <div className="cs-group-body">
                {g.rows.length === 0 ? (
                  <p className="cs-empty">{t('campusService.score.empty')}</p>
                ) : (
                  <table className="cs-mini-table">
                    <tbody>
                      {g.rows.map((r, ri) => (
                        <tr key={ri}>
                          <td>{r.name}</td>
                          <td className="cs-mini-val">{r.value != null && r.value !== '' ? r.value : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </details>
          ))}
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
            <b>{gradeData.gpa != null ? gradeData.gpa : '0'}</b>
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

  const connected = !!(status && !unavailable && status.status === 'connected')

  // ── 主页渲染 ──
  const renderMainPage = () => (
    <>
      {token && renderStatusCard()}

      {token && connected && (
        <>
          <h2 className="cs-queries-title">{t('campusService.queriesTitle')}</h2>
          <div className="cs-queries">
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
          </div>
        </>
      )}
    </>
  )

  // ── 子页面渲染 ──
  const renderSubPage = () => (
    <>
      <Link to="/tools/campus-service" className="tool-back">{t('campusService.backToCampus')}</Link>
      <h2 className="cs-sub-title">{t(KIND_LABELS[feature])}</h2>

      {token && renderStatusCard()}

      {token && connected && (
        <>
          {renderAutoCaptchaBanner()}
          {feature === 'score' && renderScore()}
          {feature === 'grades' && renderGrades()}
          {feature === 'ecard' && renderEcard()}
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
    </div>
  )
}
