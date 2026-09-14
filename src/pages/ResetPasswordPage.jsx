import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '../i18n'
import { UiIcon } from '../components/Icons'
import './Auth.css'

function ResetPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ username: '', newPassword: '', confirm: '', inviteCode: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    if (errors[e.target.name]) setErrors({ ...errors, [e.target.name]: '' })
    if (serverError) setServerError('')
  }

  const handleVerify = async () => {
    const errs = {}
    if (!form.username.trim()) errs.username = t('reset.validate.usernameRequired')
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setLoading(true)
    setServerError('')

    try {
      const checkRes = await fetch(`/api/user/check-username?username=${encodeURIComponent(form.username)}`)

      if (!checkRes.ok) {
        setServerError(t('reset.error.userNotFound'))
        setLoading(false)
        return
      }

      setStep(2)
    } catch {
      setServerError(t('reset.error.networkError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const errs = {}
    if (!form.newPassword) errs.newPassword = t('reset.validate.newPasswordRequired')
    if (form.newPassword && form.newPassword.length < 6) errs.newPassword = t('reset.validate.passwordMin')
    if (form.newPassword !== form.confirm) errs.confirm = t('reset.validate.confirmMismatch')
    if (!form.inviteCode.trim()) errs.inviteCode = t('reset.validate.inviteRequired')
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setLoading(true)
    setServerError('')

    try {
      const res = await fetch('/api/user/reset-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          new_password: form.newPassword,
          invite_code: form.inviteCode.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setServerError(data.detail || t('reset.error.resetFailed'))
        return
      }

      setSuccess(true)
    } catch {
      setServerError(t('reset.error.networkError'))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="section-inner">
          <header className="section-head">
            <div className="section-head-meta">
              <span className="folio">01</span>
              <span className="label">Reset</span>
              <Link to="/login" className="auth-back-link link-underline">&larr; {t('reset.backToLogin')}</Link>
            </div>
            <h1 className="auth-title">{t('reset.title')}</h1>
            <p className="section-desc">{t('reset.success.desc')}</p>
          </header>

          <div className="auth-body auth-body-single">
            <div className="auth-panel">
              <div className="auth-success">
                <div className="success-icon">
                  <UiIcon name="check" size={20} />
                </div>
                <h3>{t('reset.success.title')}</h3>
                <Link to="/login" className="btn btn-primary auth-submit">
                  {t('reset.success.gotoLogin')}
                  <span className="btn-arrow">&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="section-inner">
        <header className="section-head">
          <div className="section-head-meta">
            <span className="folio">01</span>
            <span className="label">Reset</span>
            <Link to="/login" className="auth-back-link link-underline">&larr; {t('reset.backToLogin')}</Link>
          </div>
          <h1 className="auth-title">{t('reset.title')}</h1>
          <p className="section-desc">
            {step === 1 ? t('reset.step1.hint') : t('reset.step2.hint')}
          </p>
        </header>

        <div className="auth-body auth-body-single">
          <div className="auth-panel">
            {step === 1 ? (
              <div className="auth-form">
                {serverError && (
                  <div className="form-server-error">{serverError}</div>
                )}

                <div className={`field ${errors.username ? 'has-error' : ''}`}>
                  <input
                    id="reset-username"
                    type="text"
                    name="username"
                    placeholder=" "
                    value={form.username}
                    onChange={handleChange}
                    autoFocus
                  />
                  <label htmlFor="reset-username">{t('reset.step1.usernameLabel')}</label>
                  {errors.username && <span className="form-error">{errors.username}</span>}
                </div>

                <button
                  type="button"
                  className="btn btn-primary auth-submit"
                  onClick={handleVerify}
                  disabled={loading}
                >
                  {loading ? t('reset.step1.verifying') : t('reset.step1.next')}
                  {!loading && <span className="btn-arrow">&rarr;</span>}
                </button>

                <p className="auth-switch">
                  {t('reset.step1.remembered')}
                  <Link to="/login" className="auth-switch-btn link-underline">{t('reset.step1.backToLogin')}</Link>
                </p>
              </div>
            ) : (
              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                {serverError && (
                  <div className="form-server-error">{serverError}</div>
                )}

                <div className={`field field-with-action ${errors.newPassword ? 'has-error' : ''}`}>
                  <input
                    id="reset-new-password"
                    type={showNewPwd ? 'text' : 'password'}
                    name="newPassword"
                    placeholder=" "
                    value={form.newPassword}
                    onChange={handleChange}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    onClick={() => setShowNewPwd(!showNewPwd)}
                    tabIndex={-1}
                    aria-label={showNewPwd ? t('reset.form.hidePwd') : t('reset.form.showPwd')}
                  >
                    <UiIcon name={showNewPwd ? 'eye-off' : 'eye'} size={18} />
                  </button>
                  <label htmlFor="reset-new-password">{t('reset.step2.newPwdLabel')}</label>
                  {errors.newPassword && <span className="form-error">{errors.newPassword}</span>}
                </div>

                <div className={`field field-with-action ${errors.confirm ? 'has-error' : ''}`}>
                  <input
                    id="reset-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    name="confirm"
                    placeholder=" "
                    value={form.confirm}
                    onChange={handleChange}
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    onClick={() => setShowConfirm(!showConfirm)}
                    tabIndex={-1}
                    aria-label={showConfirm ? t('reset.form.hidePwd') : t('reset.form.showPwd')}
                  >
                    <UiIcon name={showConfirm ? 'eye-off' : 'eye'} size={18} />
                  </button>
                  <label htmlFor="reset-confirm">{t('reset.step2.confirmLabel')}</label>
                  {errors.confirm && <span className="form-error">{errors.confirm}</span>}
                </div>

                <div className={`field ${errors.inviteCode ? 'has-error' : ''}`}>
                  <input
                    id="reset-invite"
                    type="text"
                    name="inviteCode"
                    placeholder=" "
                    value={form.inviteCode}
                    onChange={handleChange}
                  />
                  <label htmlFor="reset-invite">{t('reset.step2.inviteLabel')}</label>
                  {errors.inviteCode && <span className="form-error">{errors.inviteCode}</span>}
                </div>

                <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                  {loading ? t('reset.step2.resetting') : t('reset.step2.confirmReset')}
                  {!loading && <span className="btn-arrow">&rarr;</span>}
                </button>

                <p className="auth-switch">
                  <button type="button" className="auth-switch-btn link-underline" onClick={() => setStep(1)}>
                    &larr; {t('reset.step2.changeUsername')}
                  </button>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResetPasswordPage
