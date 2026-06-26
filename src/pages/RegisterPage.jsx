import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Auth.css'

function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '', confirm: '', inviteCode: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    if (errors[e.target.name]) setErrors({ ...errors, [e.target.name]: '' })
    if (serverError) setServerError('')
  }

  const validate = () => {
    const errs = {}
    if (!form.username.trim()) errs.username = '请输入用户名'
    if (!form.password) errs.password = '请输入密码'
    if (form.password && form.password.length < 6) errs.password = '密码至少6位'
    if (form.password !== form.confirm) errs.confirm = '两次密码不一致'
    if (!form.inviteCode.trim()) errs.inviteCode = '请输入邀请码'
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
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, password: form.password, invite_code: form.inviteCode.trim() }),
      })

      const data = await res.json()

      if (!res.ok) {
        setServerError(data.detail || '注册失败，请稍后重试')
        return
      }

      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.user))

      setTimeout(() => navigate('/'), 800)
    } catch {
      setServerError('网络错误，请检查 API 服务是否启动')
    } finally {
      setLoading(false)
    }
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
                <h2 className="auth-form-title">注册</h2>
                <Link to="/" className="auth-back-link">&larr; 返回首页</Link>
              </div>
              <p className="auth-form-hint">创建一个新账户，开始探索</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
                    placeholder="输入用户名"
                    value={form.username}
                    onChange={handleChange}
                    autoFocus
                  />
                </div>
                {errors.username && <span className="form-error">{errors.username}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">密码</label>
                <div className="form-input-wrap">
                  <span className="form-input-icon">&#128274;</span>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    name="password"
                    className={`form-input ${errors.password ? 'error' : ''}`}
                    placeholder="输入密码（至少6位）"
                    value={form.password}
                    onChange={handleChange}
                  />
                  <button
                    type="button"
                    className="pwd-toggle"
                    onClick={() => setShowPwd(!showPwd)}
                    tabIndex={-1}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showPwd ? (
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
                {errors.password && <span className="form-error">{errors.password}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">确认密码</label>
                <div className="form-input-wrap">
                  <span className="form-input-icon">&#128274;</span>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    name="confirm"
                    className={`form-input ${errors.confirm ? 'error' : ''}`}
                    placeholder="再次输入密码"
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

              <div className="form-group">
                <label className="form-label">邀请码</label>
                <div className="form-input-wrap">
                  <span className="form-input-icon">&#127873;</span>
                  <input
                    type="text"
                    name="inviteCode"
                    className={`form-input ${errors.inviteCode ? 'error' : ''}`}
                    placeholder="输入管理员发放的邀请码"
                    value={form.inviteCode}
                    onChange={handleChange}
                  />
                </div>
                {errors.inviteCode && <span className="form-error">{errors.inviteCode}</span>}
              </div>

              <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                {loading ? '注册中...' : '注册'}
                {!loading && <span className="btn-arrow">&rarr;</span>}
              </button>

              <p className="auth-switch">
                已有账户？
                <Link to="/login" className="auth-switch-btn">立即登录</Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RegisterPage
