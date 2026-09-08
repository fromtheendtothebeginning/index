import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

export default function CampusServicePage() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')

  // ── VPN 连接状态 ──
  const [status, setStatus] = useState(null) // null=加载中 | 会话 payload {connected,status,error,student_id_masked,...}
  const [unavailable, setUnavailable] = useState('') // 503：服务器 VPN 服务未启用（含错误信息）
  const [statusBusy, setStatusBusy] = useState(false) // 连接/断开请求进行中
  const [credBanner, setCredBanner] = useState(false) // 未配置凭据（connect 400）

  // ── 查询结果 ──
  const [scoreData, setScoreData] = useState(null)
  const [gradeData, setGradeData] = useState(null)
  const [gradeTerms, setGradeTerms] = useState([])
  const [gradeTerm, setGradeTerm] = useState('') // `${xnm}|${xqm}`，''=全部
  const [ecardData, setEcardData] = useState(null)
  const [ecardCount, setEcardCount] = useState(0)
  const [qBusy, setQBusy] = useState(null) // 正在查询的 kind
  const [errMsg, setErrMsg] = useState('')

  // ── 验证码两段式 ──
  const [captcha, setCaptcha] = useState(null) // {kind, xnm, xqm, image, err, submitting}
  const [capInput, setCapInput] = useState('')

  // 请求竞态防护：断开连接后丢弃迟到的查询响应
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

  // 初始状态
  useEffect(() => {
    if (!token) return
    fetchStatus()
  }, [token, fetchStatus])

  // creating/connecting 时每 3 秒轮询
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
    } catch { /* 忽略：随后以状态查询结果为准 */ }
    // 作废在途查询响应，清空全部结果区
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
    fetchStatus()
  }

  // ── 结果写入 ──
  const applyResult = (kind, data) => {
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

  // ── 统一查询（含验证码两段式入口）──
  const doQuery = async (kind, params = {}) => {
    if (!token || busyRef.current) return
    busyRef.current = true
    const ep = epochRef.current
    setQBusy(kind)
    setErrMsg('')
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

  // ── 校园卡动态码自动刷新（按后端 refresh 秒数倒计时）──
  useEffect(() => {
    if (!token || !status || status.status !== 'connected' || !ecardData || !ecardData.refresh) {
      setEcardCount(0)
      return
    }
    if (captcha) return // 验证码弹窗期间暂停倒计时，关闭后重新计时
    let n = ecardData.refresh
    setEcardCount(n)
    const timer = setInterval(() => {
      n -= 1
      if (n <= 0) {
        // 触发自动刷新；无论成功失败都从整周期重新计时（成功会换新 ecardData 重建本计时器）
        n = ecardData.refresh
        doQuery('ecard')
      }
      setEcardCount(n)
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, status, ecardData, captcha])

  const goFillCreds = () => {
    localStorage.setItem('my_tab', 'campus')
    navigate('/my')
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

        {token && renderStatusCard()}

        {token && connected && (
          <>
            <h2 className="cs-queries-title">{t('campusService.queriesTitle')}</h2>
            <div className="cs-queries">
              <button type="button" className="cs-qcard" onClick={() => doQuery('score')} disabled={!!qBusy || !!captcha}>
                <span className="cs-qcard-name">{t('campusService.query.score')}</span>
                <span className="cs-qcard-desc">{t('campusService.query.scoreDesc')}</span>
                {qBusy === 'score' ? (
                  <span className="cs-qcard-state"><span className="cs-spinner" />{t('campusService.query.scoreLoading')}</span>
                ) : (
                  <span className="cs-qcard-state">{'›'}</span>
                )}
              </button>
              <button type="button" className="cs-qcard" onClick={() => doQuery('grades')} disabled={!!qBusy || !!captcha}>
                <span className="cs-qcard-name">{t('campusService.query.grades')}</span>
                <span className="cs-qcard-desc">{t('campusService.query.gradesDesc')}</span>
                {qBusy === 'grades' ? (
                  <span className="cs-qcard-state"><span className="cs-spinner" />{t('campusService.query.gradesLoading')}</span>
                ) : (
                  <span className="cs-qcard-state">{'›'}</span>
                )}
              </button>
              <button type="button" className="cs-qcard" onClick={() => doQuery('ecard')} disabled={!!qBusy || !!captcha}>
                <span className="cs-qcard-name">{t('campusService.query.ecard')}</span>
                <span className="cs-qcard-desc">{t('campusService.query.ecardDesc')}</span>
                {qBusy === 'ecard' ? (
                  <span className="cs-qcard-state"><span className="cs-spinner" />{t('campusService.query.ecardLoading')}</span>
                ) : (
                  <span className="cs-qcard-state">{'›'}</span>
                )}
              </button>
            </div>

            {renderScore()}
            {renderGrades()}
            {renderEcard()}
          </>
        )}
      </div>

      {renderCaptchaModal()}
    </div>
  )
}
