import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Auth.css'

const API_BASE = '/api'

function AuthPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ username: '', password: '', confirm: '' })
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
    if (!form.username.trim()) errs.username = '请输入用户名'
    if (!form.password) errs.password = '请输入密码'
    if (form.password && form.password.length < 6) errs.password = '密码至少6位'
    if (mode === 'register' && form.password !== form.confirm) errs.confirm = '两次密码不一致'
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
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setServerError(data.detail || '请求失败，请稍后重试')
        return
      }

      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      setSubmitted(true)

      if (mode === 'login') {
        setTimeout(() => navigate('/'), 1500)
      }
    } catch (err) {
      setServerError('网络错误，请检查 API 服务是否启动')
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
      <div className="auth-grid" />
      <div className="auth-glow ag-1" />
      <div className="auth-glow ag-2" />

      <div className="auth-container">
        <div className="auth-brand">
          <div className="auth-brand-content">
            <Link to="/" className="auth-brand-logo">
              <img src="/favicon.svg" alt="anticraft" className="brand-logo-img" />
            </Link>
            <h1 className="auth-brand-title">
              <span className="brand-title-en">anticraft</span>
              <span className="brand-title-cn">逆匠</span>
            </h1>
            <p className="auth-brand-desc">
              以匠心为刃，破常规之笼。
            </p>
            <blockquote className="auth-brand-quote">
              &ldquo;在秩序中寻找裂痕，<br />在裂痕中创造可能。&rdquo;
            </blockquote>
            <Link to="/" className="auth-back-link">
              &larr; 返回首页
            </Link>
          </div>
        </div>

        <div className="auth-form-wrap">
          <div className="auth-form-card">
            <div className="auth-form-header">
              <div className="auth-tabs">
                <button
                  className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                  onClick={() => switchMode()}
                  disabled={mode === 'login'}
                >
                  登录
                </button>
                <button
                  className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
                  onClick={() => switchMode()}
                  disabled={mode === 'register'}
                >
                  注册
                </button>
              </div>
              <p className="auth-form-hint">
                {mode === 'login'
                  ? '欢迎回来，请登录你的账户'
                  : '创建一个新账户，开始探索'}
              </p>
            </div>

            {submitted ? (
              <div className="auth-success">
                <div className="success-icon">&#10003;</div>
                <h3>{mode === 'login' ? '登录成功' : '注册成功'}</h3>
                <p>
                  {mode === 'login'
                    ? '正在跳转到首页...'
                    : '请登录你的新账户'}
                </p>
                {mode === 'register' && (
                  <button className="btn btn-primary" onClick={() => { setMode('login'); setSubmitted(false) }}>
                    前往登录
                  </button>
                )}
              </div>
            ) : (
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
                      placeholder="输入密码"
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

                {mode === 'register' && (
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
                )}

                <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                  {loading ? '处理中...' : (mode === 'login' ? '登录' : '注册')}
                  {!loading && <span className="btn-arrow">&rarr;</span>}
                </button>

                <p className="auth-switch">
                  {mode === 'login' ? (
                    <>还没有账户？
                      <button type="button" className="auth-switch-btn" onClick={switchMode}>立即注册</button>
                    </>
                  ) : (
                    <>已有账户？
                      <button type="button" className="auth-switch-btn" onClick={switchMode}>立即登录</button>
                    </>
                  )}
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
