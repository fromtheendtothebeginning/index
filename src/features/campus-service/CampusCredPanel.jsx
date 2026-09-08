import { useState, useEffect } from 'react'
import ActionButton from '../../components/ActionButton'
import { t } from '../../i18n'
import './CampusCredPanel.css'

const EMPTY_FORM = { student_id: '', real_name: '', vpn_password: '', pay_password: '' }

/**
 * 「我的 → 校园服务」凭据填写面板（MyPage 第三个 tab 内容）。
 * GET /api/campus/cred 展示当前配置；PUT /api/campus/cred 保存。
 * 密码留空 = 保留原值；GET 只回打码学号，故学号不可回填（输入框占位提示）。
 */
export default function CampusCredPanel() {
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)
  const [info, setInfo] = useState({ configured: false })
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

  const refreshInfo = async (keepForm) => {
    try {
      const res = await fetch('/api/campus/cred', { headers: authHeaders() })
      const b = await res.json().catch(() => null)
      if (!res.ok || !b) return null
      setInfo(b)
      setLoadErr(false)
      if (!keepForm) {
        setForm(f => ({ ...f, student_id: '', real_name: b.real_name || '' }))
      }
      return b
    } catch {
      setLoadErr(true)
      return null
    }
  }

  useEffect(() => {
    refreshInfo(false).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.student_id.trim()) { setErr(t('campusService.cred.errStudentId')); return }
    if (!info.configured && !form.vpn_password.trim()) { setErr(t('campusService.cred.errVpnFirst')); return }
    setSaving(true)
    setErr('')
    setSaved(false)
    try {
      const res = await fetch('/api/campus/cred', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: form.student_id.trim(),
          real_name: form.real_name.trim(),
          vpn_password: form.vpn_password,
          pay_password: form.pay_password,
        }),
      })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(b && b.detail ? String(b.detail) : t('campusService.cred.saveFailed', { error: t('campusService.error') }))
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      // 重新拉取当前配置并回填姓名（学号只回打码值，不可回填输入框）
      setForm(f => ({ ...f, vpn_password: '', pay_password: '' }))
      refreshInfo(true).then(b => {
        if (b) setForm(f => ({ ...f, real_name: b.real_name || '' }))
      })
    } catch {
      setErr(t('campusService.cred.networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ccp-panel">
      <div className="ccp-head">
        <div className="ccp-title">{t('campusService.cred.title')}</div>
        <p className="ccp-sub">{t('campusService.cred.subtitle')}</p>
      </div>

      {loading ? (
        <div className="ccp-loading">{t('campusService.loading')}</div>
      ) : loadErr ? (
        <div className="ccp-err">
          {t('campusService.cred.loadFailed')}
          <div className="ccp-err-ops">
            <ActionButton size="sm" onClick={() => refreshInfo(false)}>{t('campusService.retry')}</ActionButton>
          </div>
        </div>
      ) : (
        <>
          {info.configured ? (
            <div className="ccp-current">
              <span className="ccp-current-label">{t('campusService.cred.current')}</span>
              <span className="ccp-chip">{info.student_id_masked}</span>
              <span className="ccp-chip">{info.real_name}</span>
              <span className={`ccp-chip ${info.has_pay_password ? 'ccp-chip-ok' : 'ccp-chip-off'}`}>
                {info.has_pay_password ? t('campusService.cred.paySet') : t('campusService.cred.payNotSet')}
              </span>
            </div>
          ) : (
            <>
              <span className="ccp-chip ccp-chip-off">{t('campusService.cred.notConfigured')}</span>
              <p className="ccp-none">{t('campusService.cred.noneHint')}</p>
            </>
          )}

          <div className="ccp-form">
            <div className="ccp-field">
              <label className="ccp-label" htmlFor="ccp-student-id">{t('campusService.cred.studentId')}</label>
              <input
                id="ccp-student-id"
                className="ccp-input"
                type="text"
                value={form.student_id}
                maxLength={32}
                autoComplete="off"
                placeholder={info.configured ? `${t('campusService.cred.sidMasked', { sid: info.student_id_masked })}` : ''}
                onChange={e => setField('student_id', e.target.value)}
              />
              {info.configured && <p className="ccp-hint">{t('campusService.cred.sidHint')}</p>}
            </div>

            <div className="ccp-field">
              <label className="ccp-label" htmlFor="ccp-real-name">{t('campusService.cred.realName')}</label>
              <input
                id="ccp-real-name"
                className="ccp-input"
                type="text"
                value={form.real_name}
                maxLength={32}
                autoComplete="off"
                onChange={e => setField('real_name', e.target.value)}
              />
            </div>

            <div className="ccp-field">
              <label className="ccp-label" htmlFor="ccp-vpn-pwd">{t('campusService.cred.vpnPassword')}</label>
              <input
                id="ccp-vpn-pwd"
                className="ccp-input"
                type="password"
                value={form.vpn_password}
                maxLength={128}
                autoComplete="new-password"
                onChange={e => setField('vpn_password', e.target.value)}
              />
              {info.configured && <p className="ccp-hint">{t('campusService.cred.keepHint')}</p>}
            </div>

            <div className="ccp-field">
              <label className="ccp-label" htmlFor="ccp-pay-pwd">{t('campusService.cred.payPassword')}</label>
              <input
                id="ccp-pay-pwd"
                className="ccp-input"
                type="password"
                value={form.pay_password}
                maxLength={128}
                autoComplete="new-password"
                onChange={e => setField('pay_password', e.target.value)}
              />
              <p className="ccp-hint">{t('campusService.cred.payHint')}</p>
            </div>

            {err && <div className="ccp-err">{err}</div>}

            <div className="ccp-actions">
              <ActionButton variant="accent" onClick={handleSave} disabled={saving}>
                {saving ? t('campusService.cred.saving') : t('campusService.cred.save')}
              </ActionButton>
              {saved && <span className="ccp-saved">&#10003; {t('campusService.cred.saved')}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
