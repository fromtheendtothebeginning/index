import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Auth.css'

function ResetPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ username: '', newPassword: '', confirm: '' })
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
    if (!form.username.trim()) errs.username = '请输入用户名'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setLoading(true)
    setServerError('')

    try {
      const checkRes = await fetch(`/api/user/check-username?username=${encodeURIComponent(form.username)}`)

      if (!checkRes.ok) {
        setServerError('用户不存在')
        setLoading(false)
        return
      }

      setStep(2)
    } catch {
      setServerError('网络错误，请检查 API 服务是否启动')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const errs = {}
    if (!form.newPassword) errs.newPassword = '请输入新密码'
    if (form.newPassword && form.newPassword.length < 6) errs.newPassword = '密码至少6位'
    if (form.newPassword !== form.confirm) errs.confirm = '两次密码不一致'
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
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setServerError(data.detail || '重置失败，请稍后重试')
        return
      }

      setSuccess(true)
    } catch {
      setServerError('网络错误，请检查 API 服务是否启动')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-grid" />
        <div className="auth-glow ag-1" />
        <div className="auth-glow ag-2" />
        <div className="auth-container" style={{ maxWidth: 480, minHeight: 400 }}>
          <div className="auth-form-wrap" style={{ flex: 'none', width: '100%' }}>
            <div className="auth-success">
              <div className="success-icon">&#10003;</div>
              <h3>密码重置成功</h3>
              <p>请使用新密码登录你的账户</p>
              <Link to="/login" className="btn btn-primary auth-submit" style={{ display: 'inline-flex', width: 'auto', textDecoration: 'none' }}>
                前往登录 &rarr;
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-grid" />
      <div className="auth-glow ag-1" />
      <div className="auth-glow ag-2" />

      <div className="auth-container">
        <div className="auth-brand">
          <div className="auth-brand-content">
            <Link to="/" className="auth-brand-header">
              <img src="/favicon.svg" alt="anticraft" className="brand-logo-img" />
              <span className="brand-title-en">anticraft</span>
            </Link>
          </div>
        </div>

        <div className="auth-form-wrap">
          <div className="auth-form-card">
            <div className="auth-form-header">
              <div className="auth-form-title-row">
                <h2 className="auth-form-title">重置密码</h2>
                <Link to="/login" className="auth-back-link">&larr; 返回登录</Link>
              </div>
              <p className="auth-form-hint">
                {step === 1 ? '请输入你的用户名以开始重置' : '设置你的新密码'}
              </p>
            </div>

            {step === 1 ? (
              <div className="auth-form">
                {serverError && (
                  <div className="form-server-error">{serverError}</div>
                )}

                <div className="form-group">
                  <label className="form-label">用户名</label>
                  <div className="form-input-wrap">
                    <span className="form-input-icon">&#128100;</span>
                    <input
                      type="text"
                      name="username"
                      className={`form-input ${errors.username ? 'error' : ''}`}
                      placeholder="输入你的用户名"
                      value={form.username}
                      onChange={handleChange}
                      autoFocus
                    />
                  </div>
                  {errors.username && <span className="form-error">{errors.username}</span>}
                </div>

                <button
                  type="button"
                  className="btn btn-primary auth-submit"
                  onClick={handleVerify}
                  disabled={loading}
                >
                  {loading ? '验证中...' : '下一步'}
                  {!loading && <span className="btn-arrow">&rarr;</span>}
                </button>

                <p className="auth-switch">
                  想起密码了？
                  <Link to="/login" className="auth-switch-btn">返回登录</Link>
                </p>
              </div>
            ) : (
              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                {serverError && (
                  <div className="form-server-error">{serverError}</div>
                )}

                <div className="form-group">
                  <label className="form-label">新密码</label>
                  <div className="form-input-wrap">
                    <span className="form-input-icon">&#128274;</span>
                    <input
                      type={showNewPwd ? 'text' : 'password'}
                      name="newPassword"
                      className={`form-input ${errors.newPassword ? 'error' : ''}`}
                      placeholder="输入新密码（至少6位）"
                      value={form.newPassword}
                      onChange={handleChange}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="pwd-toggle"
                      onClick={() => setShowNewPwd(!showNewPwd)}
                      tabIndex={-1}
                      aria-label={showNewPwd ? '隐藏密码' : '显示密码'}
                    >
                      {showNewPwd ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                  {errors.newPassword && <span className="form-error">{errors.newPassword}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">确认新密码</label>
                  <div className="form-input-wrap">
                    <span className="form-input-icon">&#128274;</span>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      name="confirm"
                      className={`form-input ${errors.confirm ? 'error' : ''}`}
                      placeholder="再次输入新密码"
                      value={form.confirm}
                      onChange={handleChange}
                    />
                    <button
                      type="button"
                      className="pwd-toggle"
                      onClick={() => setShowConfirm(!showConfirm)}
                      tabIndex={-1}
                      aria-label={showConfirm ? '隐藏密码' : '显示密码'}
                    >
                      {showConfirm ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                  {errors.confirm && <span className="form-error">{errors.confirm}</span>}
                </div>

                <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                  {loading ? '重置中...' : '确认重置'}
                  {!loading && <span className="btn-arrow">&rarr;</span>}
                </button>

                <p className="auth-switch">
                  <button type="button" className="auth-switch-btn" onClick={() => setStep(1)}>
                    &larr; 更换用户名
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
