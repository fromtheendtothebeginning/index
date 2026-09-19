import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Modal from '../../components/Modal'
import { t } from '../../i18n'
import '../../pages/ToolParsePage.css'
import './PoolAdminPage.css'

// 会话状态徽标：让位 > 待命 > cas_ready > connected(登录学工中) > connecting > failed > 停用
// （学校限制单 IP 一条隧道：同一时间只有第一个启用的账号在线，其余待命；用户会话在线时池让位）
function statusMeta(a, poolYielded) {
  if (!a.enabled) return { key: 'campusPool.stDisabled', cls: 'cp-badge-muted' }
  if (!a.active) return { key: 'campusPool.stStandby', cls: 'cp-badge-muted' }
  if (poolYielded) return { key: 'campusPool.stYielded', cls: 'cp-badge-busy' }
  if (a.cas_ready) return { key: 'campusPool.stReady', cls: 'cp-badge-ok' }
  if (a.status === 'connected') return { key: 'campusPool.stLogging', cls: 'cp-badge-busy' }
  if (a.status === 'connecting' || a.status === 'creating') return { key: 'campusPool.stConnecting', cls: 'cp-badge-busy' }
  if (a.status === 'failed') return { key: 'campusPool.stFailed', cls: 'cp-badge-danger' }
  return { key: 'campusPool.stIdle', cls: 'cp-badge-muted' }
}

export default function PoolAdminPage() {
  const token = localStorage.getItem('token')
  const isAdmin = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').role === 'admin' } catch { return false }
  })()

  const [accounts, setAccounts] = useState(null)
  const [visionReady, setVisionReady] = useState(true)
  const [poolYielded, setPoolYielded] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [toggling, setToggling] = useState(null)

  // 添加表单
  const [sid, setSid] = useState('')
  const [pwd, setPwd] = useState('')
  const [label, setLabel] = useState('')
  const [formMsg, setFormMsg] = useState('')

  const [delTarget, setDelTarget] = useState(null) // { id, label }

  const load = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/campus/pool', { headers: { Authorization: `Bearer ${token}` } })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        setErrMsg(b && b.detail ? String(b.detail) : t('campusService.error'))
        return
      }
      setErrMsg('')
      setAccounts(b.accounts || [])
      setVisionReady(b.vision_ready !== false)
      setPoolYielded(!!b.yielded)
    } catch {
      setErrMsg(t('campusService.error'))
    }
  }, [token])

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin, load])

  const handleAdd = async () => {
    if (!sid.trim() || !pwd) {
      setFormMsg(t('campusPool.needSidPwd'))
      return
    }
    setBusy(true)
    setFormMsg('')
    try {
      const res = await fetch('/api/campus/pool', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: sid.trim(), password: pwd, label: label.trim() }),
      })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        setFormMsg(b && b.detail ? String(b.detail) : t('campusService.error'))
        return
      }
      setSid(''); setPwd(''); setLabel(''); setFormMsg('')
      load()
    } catch {
      setFormMsg(t('campusService.error'))
    } finally {
      setBusy(false)
    }
  }

  const handleToggle = async (a) => {
    setToggling(a.id)
    try {
      await fetch(`/api/campus/pool/${a.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !a.enabled }),
      })
      load()
    } catch { /* 忽略 */ } finally {
      setToggling(null)
    }
  }

  const handleDelete = async () => {
    if (!delTarget) return
    setBusy(true)
    try {
      await fetch(`/api/campus/pool/${delTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setDelTarget(null)
      load()
    } catch { /* 忽略 */ } finally {
      setBusy(false)
    }
  }

  if (!token || !isAdmin) {
    return (
      <div className="tool-page">
        <Navbar activePage="tools" />
        <div className="tool-main">
          <header className="tool-header">
            <Link to="/tools/campus-service" className="tool-back">{t('campusService.backToCampus')}</Link>
            <h1 className="tool-title">{t('campusPool.title')}</h1>
          </header>
          <div className="tool-login-hint">{t('campusPool.adminOnly')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main">
        <header className="tool-header">
          <Link to="/tools/campus-service" className="tool-back">{t('campusService.backToCampus')}</Link>
          <h1 className="tool-title">{t('campusPool.title')}</h1>
          <p className="tool-subtitle">{t('campusPool.subtitle')}</p>
        </header>

        {!visionReady && (
          <div className="cp-warn">{t('campusPool.visionMissing')}</div>
        )}
        {errMsg && <div className="tool-error">{errMsg}</div>}

        <div className="cp-panel">
          <h2 className="cp-panel-title">{t('campusPool.accountsTitle')}</h2>
          {accounts === null ? (
            <p className="cp-empty">{t('campusService.loading')}</p>
          ) : accounts.length === 0 ? (
            <p className="cp-empty">{t('campusPool.empty')}</p>
          ) : (
            <div className="cp-list">
              {accounts.map(a => {
                const meta = statusMeta(a, poolYielded)
                return (
                  <div key={a.id} className="cp-row">
                    <div className="cp-row-main">
                      <span className={`cp-badge ${meta.cls}`}>{t(meta.key)}</span>
                      <span className="cp-sid">{a.student_id_masked}</span>
                      {a.label && <span className="cp-label">{a.label}</span>}
                      {a.status === 'failed' && a.error && <span className="cp-err" title={a.error}>{a.error}</span>}
                    </div>
                    <div className="cp-row-ops">
                      <button
                        type="button"
                        className="btn btn-secondary cp-op-btn"
                        disabled={toggling === a.id}
                        onClick={() => handleToggle(a)}
                      >
                        {a.enabled ? t('campusPool.disable') : t('campusPool.enable')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary cp-op-btn cp-op-danger"
                        onClick={() => setDelTarget({ id: a.id, label: a.label || a.student_id_masked })}
                      >
                        {t('campusPool.delete')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="cp-hint">{t('campusPool.listHint')}</p>
        </div>

        <div className="cp-panel">
          <h2 className="cp-panel-title">{t('campusPool.addTitle')}</h2>
          <div className="cp-form">
            <input
              className="tool-input cp-input"
              placeholder={t('campusPool.studentId')}
              value={sid}
              onChange={e => setSid(e.target.value)}
            />
            <input
              className="tool-input cp-input"
              type="password"
              placeholder={t('campusPool.password')}
              value={pwd}
              onChange={e => setPwd(e.target.value)}
            />
            <input
              className="tool-input cp-input cp-input-label"
              placeholder={t('campusPool.label')}
              value={label}
              maxLength={50}
              onChange={e => setLabel(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleAdd} disabled={busy || !sid.trim() || !pwd}>
              {busy ? t('campusPool.adding') : t('campusPool.add')}
            </button>
          </div>
          {formMsg && <p className="cp-form-msg">{formMsg}</p>}
          <p className="cp-hint">{t('campusPool.addHint')}</p>
        </div>
      </div>

      <Modal
        open={!!delTarget}
        title={t('campusPool.deleteTitle')}
        confirmText={t('campusPool.delete')}
        cancelText={t('modal.cancel')}
        confirmDisabled={busy}
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
      >
        <p className="cp-del-text">{t('campusPool.deleteText', { name: delTarget ? delTarget.label : '' })}</p>
      </Modal>
    </div>
  )
}
