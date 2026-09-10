import { useState, useEffect } from 'react'
import ActionButton from '../../components/ActionButton'
import { t } from '../../i18n'
import { CAMPUSES, DEFAULT_CAMPUS, parseDorm, buildDorm } from './dorm'
import './CampusCredPanel.css'

const EMPTY_FORM = {
  student_id: '', real_name: '', vpn_password: '', pay_password: '', auto_captcha: false,
  campus: DEFAULT_CAMPUS, building: '', room: '',
}

// 校区选项：value 是写进 dorm 串的中文名（后端按串解析），文案走 i18n
const CAMPUS_LABEL_KEYS = {
  '奉贤校区': 'campusService.cred.campusFengxian',
  '徐汇校区': 'campusService.cred.campusXuhui',
}

/**
 * 「我的 → 校园服务」凭据填写面板（MyPage 第三个 tab 内容）。
 * GET /api/campus/cred 展示当前配置；PUT /api/campus/cred 保存。
 * 密码留空 = 保留原值；GET 同时回完整学号（student_id，回填输入框）与打码学号（student_id_masked，仅顶部展示）。
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
        setForm(f => ({
          ...f, student_id: b.student_id || '', real_name: b.real_name || '', auto_captcha: !!b.auto_captcha,
          ...parseDorm(b.dorm),
        }))
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
    // 楼号与宿舍号必须成对：只填其一 → 报错且不发请求（都为空 = 清空寝室，允许）
    const building = form.building.trim()
    const room = form.room.trim()
    if (!!building !== !!room) { setErr(t('campusService.cred.dormIncomplete')); return }
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
          auto_captcha: !!form.auto_captcha,
          dorm: buildDorm(form.campus, building, room),
        }),
      })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(b && b.detail ? String(b.detail) : t('campusService.cred.saveFailed', { error: t('campusService.error') }))
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      // 重新拉取当前配置并回填学号、姓名
      setForm(f => ({ ...f, vpn_password: '', pay_password: '' }))
      refreshInfo(true).then(b => {
        if (b) setForm(f => ({ ...f, student_id: b.student_id || '', real_name: b.real_name || '', ...parseDorm(b.dorm) }))
      })
    } catch {
      setErr(t('campusService.cred.networkError'))
    } finally {
      setSaving(false)
    }
  }

  const dormPreview = buildDorm(form.campus, form.building, form.room)

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

            <label className="ccp-row ccp-checkbox-row">
              <input
                type="checkbox"
                checked={!!form.auto_captcha}
                onChange={e => setForm({...form, auto_captcha: e.target.checked})}
              />
              <span>{t('campusService.cred.autoCaptcha')}</span>
              <span className="ccp-hint">{t('campusService.cred.autoCaptchaHint')}</span>
            </label>

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

            <div className="ccp-dorm-grid">
              <div className="ccp-field">
                <label className="ccp-label" htmlFor="ccp-dorm-campus">{t('campusService.cred.campus')}</label>
                <select
                  id="ccp-dorm-campus"
                  className="ccp-input"
                  value={form.campus}
                  onChange={e => setField('campus', e.target.value)}
                >
                  {CAMPUSES.map(c => (
                    <option key={c} value={c}>{t(CAMPUS_LABEL_KEYS[c])}</option>
                  ))}
                </select>
              </div>

              <div className="ccp-field">
                <label className="ccp-label" htmlFor="ccp-dorm-building">{t('campusService.cred.building')}</label>
                <input
                  id="ccp-dorm-building"
                  className="ccp-input"
                  type="text"
                  inputMode="numeric"
                  value={form.building}
                  maxLength={4}
                  autoComplete="off"
                  onChange={e => setField('building', e.target.value.replace(/\D/g, ''))}
                />
              </div>

              <div className="ccp-field">
                <label className="ccp-label" htmlFor="ccp-dorm-room">{t('campusService.cred.room')}</label>
                <input
                  id="ccp-dorm-room"
                  className="ccp-input"
                  type="text"
                  value={form.room}
                  maxLength={12}
                  autoComplete="off"
                  onChange={e => setField('room', e.target.value.replace(/[^0-9A-Za-z]/g, ''))}
                />
              </div>
            </div>

            {dormPreview && <p className="ccp-hint">{t('campusService.cred.dormPreview', { dorm: dormPreview })}</p>}
            <p className="ccp-hint">{t('campusService.cred.dormHint')}</p>

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
