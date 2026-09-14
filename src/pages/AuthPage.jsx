import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '../i18n'
import { UiIcon } from '../components/Icons'
import './Auth.css'

function AuthPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ username: '', password: '', confirm: '', inviteCode: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    if (errors[e.target.name]) setErrors({ ...errors, [e.target.name]: '' })
    if (serverError) setServerError('')
  }

  const validate = () => {
    const errs = {}
    if (!form.username.trim()) errs.username = t('auth.validate.usernameRequired')
    if (!form.password) errs.password = t('auth.validate.passwordRequired')
    if (form.password && form.password.length < 6) errs.password = t('auth.validate.passwordMin')
    if (mode === 'register' && form.password !== form.confirm) errs.confirm = t('auth.validate.confirmMismatch')
    if (mode === 'register' && !form.inviteCode.trim()) errs.inviteCode = t('auth.validate.inviteRequired')
    return errs
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setLoading(true)
    setServerError('')

    try {
      const endpoint = mode === 'login' ? '/api/login' : '/api/register'
      const body = {
        username: form.username,
        password: form.password,
        ...(mode === 'register' ? { invite_code: form.inviteCode.trim() } : {}),
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setServerError(data.detail || t('auth.error.requestFailed'))
        return
      }

      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      setSubmitted(true)

      // 注册成功后同样直接跳转首页（后端已返回 token）
      setTimeout(() => navigate('/'), 1500)
    } catch (err) {
      setServerError(t('auth.error.networkError'))
    } finally {
      setLoading(false)
    }
  }

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setErrors({})
    setServerError('')
    setSubmitted(false)
  }

  return (
    <div className="auth-page">
      <div className="section-inner">
        <header className="section-head">
          <div className="section-head-meta">
            <span className="folio">01</span>
            <span className="label">Account</span>
            <Link to="/" className="auth-back-link link-underline">
              &larr; {t('auth.brand.backHome')}
            </Link>
          </div>
          <h1 className="auth-title">
            <span className="brand-title-en">anticraft</span>
            <span className="brand-title-cn">anticraft</span>
          </h1>
          <p className="section-desc">
            {mode === 'login'
              ? t('auth.form.hintLogin')
              : t('auth.form.hintRegister')}
          </p>
        </header>

        <div className="auth-body">
          <div className="auth-panel">
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab label ${mode === 'login' ? 'active' : ''}`}
                onClick={() => switchMode()}
                disabled={mode === 'login'}
              >
                {t('auth.tab.login')}
              </button>
              <button
                type="button"
                className={`auth-tab label ${mode === 'register' ? 'active' : ''}`}
                onClick={() => switchMode()}
                disabled={mode === 'register'}
              >
                {t('auth.tab.register')}
              </button>
            </div>

            {submitted ? (
              <div className="auth-success">
                <div className="success-icon">
                  <UiIcon name="check" size={20} />
                </div>
                <h3>{mode === 'login' ? t('auth.success.login') : t('auth.success.register')}</h3>
                <p>{t('auth.success.redirecting')}</p>
              </div>
            ) : (
              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                {serverError && (
                  <div className="form-server-error">{serverError}</div>
                )}

                <div className={`field ${errors.username ? 'has-error' : ''}`}>
                  <input
                    id="auth-username"
                    type="text"
                    name="username"
                    placeholder=" "
                    value={form.username}
                    onChange={handleChange}
                    autoFocus
                  />
                  <label htmlFor="auth-username">{t('auth.form.usernameLabel')}</label>
                  {errors.username && <span className="form-error">{errors.username}</span>}
                </div>

                <div className={`field field-with-action ${errors.password ? 'has-error' : ''}`}>
                  <input
                    id="auth-password"
                    type={showPwd ? 'text' : 'password'}
                    name="password"
                    placeholder=" "
                    value={form.password}
                    onChange={handleChange}
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    onClick={() => setShowPwd(!showPwd)}
                    tabIndex={-1}
                    aria-label={showPwd ? t('auth.form.hidePwd') : t('auth.form.showPwd')}
                  >
                    <UiIcon name={showPwd ? 'eye-off' : 'eye'} size={18} />
                  </button>
                  <label htmlFor="auth-password">{t('auth.form.passwordLabel')}</label>
                  {errors.password && <span className="form-error">{errors.password}</span>}
                </div>

                {mode === 'login' && (
                  <div className="auth-form-extra">
                    <Link to="/reset-password" className="forgot-password-link link-underline">{t('auth.form.forgotPassword')}</Link>
                  </div>
                )}

                {mode === 'register' && (
                  <div className={`field field-with-action ${errors.confirm ? 'has-error' : ''}`}>
                    <input
                      id="auth-confirm"
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
                      aria-label={showConfirm ? t('auth.form.hidePwd') : t('auth.form.showPwd')}
                    >
                      <UiIcon name={showConfirm ? 'eye-off' : 'eye'} size={18} />
                    </button>
                    <label htmlFor="auth-confirm">{t('auth.form.confirmLabel')}</label>
                    {errors.confirm && <span className="form-error">{errors.confirm}</span>}
                  </div>
                )}

                {mode === 'register' && (
                  <div className={`field ${errors.inviteCode ? 'has-error' : ''}`}>
                    <input
                      id="auth-invite"
                      type="text"
                      name="inviteCode"
                      placeholder=" "
                      value={form.inviteCode}
                      onChange={handleChange}
                    />
                    <label htmlFor="auth-invite">{t('auth.form.inviteLabel')}</label>
                    {errors.inviteCode && <span className="form-error">{errors.inviteCode}</span>}
                  </div>
                )}

                <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                  {loading ? t('auth.form.processing') : (mode === 'login' ? t('auth.tab.login') : t('auth.tab.register'))}
                  {!loading && <span className="btn-arrow">&rarr;</span>}
                </button>

                <p className="auth-switch">
                  {mode === 'login' ? (
                    <>{t('auth.switch.noAccount')}
                      <button type="button" className="auth-switch-btn link-underline" onClick={switchMode}>{t('auth.switch.toRegister')}</button>
                    </>
                  ) : (
                    <>{t('auth.switch.hasAccount')}
                      <button type="button" className="auth-switch-btn link-underline" onClick={switchMode}>{t('auth.switch.toLogin')}</button>
                    </>
                  )}
                </p>
              </form>
            )}
          </div>

          <aside className="auth-brand">
            <Link to="/" className="auth-brand-logo">
              <img src="/favicon.svg" alt="anticraft" className="brand-logo-img" />
            </Link>
            <p className="auth-brand-desc">
              {t('auth.brand.desc')}
            </p>
            <blockquote className="auth-brand-quote">
              &ldquo;{t('auth.brand.quote1')}<br />{t('auth.brand.quote2')}&rdquo;
            </blockquote>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
