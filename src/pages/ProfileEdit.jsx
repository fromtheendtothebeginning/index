import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { changeThemeWithTransition } from '../utils/themeTransition'
import './ProfileEdit.css'

function ProfileEdit() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [nickname, setNickname] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system')

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    if (!token || !userStr) {
      navigate('/auth')
      return
    }
    // 校验账户是否仍在数据库中存在，不存在则退出登录
    fetch('/api/user/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (r.status === 401 || r.status === 404) {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          navigate('/auth')
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (!data) return
        localStorage.setItem('user', JSON.stringify(data))
        setUser(data)
        setNickname(data.nickname || '')
        setAvatarUrl(data.avatar_url || '')
      })
      .catch(() => {
        // 网络错误时回退到 localStorage
        const u = JSON.parse(userStr)
        setUser(u)
        setNickname(u.nickname || '')
        setAvatarUrl(u.avatar_url || '')
      })
  }, [navigate])

  const getInitial = (name) => {
    return name ? name.charAt(0).toUpperCase() : '?'
  }

  const handleSave = async () => {
    const token = localStorage.getItem('token')
    setSaving(true)
    setError('')
    setSaved(false)

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nickname: nickname.trim() || null,
          avatar_url: avatarUrl.trim() || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || '保存失败')
        return
      }

      // 更新本地存储
      localStorage.setItem('user', JSON.stringify(data))
      setUser(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  // 返回来源页面（点击头像进入时由 Navbar 记录）；无记录则回首页
  const backTarget = sessionStorage.getItem('profile_redirect') || '/'
  const backLabel = backTarget.startsWith('/blogs')
    ? '返回博客'
    : backTarget.startsWith('/projects')
      ? '返回项目'
      : backTarget !== '/'
        ? '返回'
        : '返回首页'
  const handleBack = () => {
    sessionStorage.removeItem('profile_redirect')
  }

  // 主题模式切换（浅色 ↔ 深色 渐变）
  const handleChangeTheme = (next) => {
    localStorage.setItem('theme', next)
    changeThemeWithTransition(next)
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }))
    setTheme(next)
  }

  return (
    <div className="profile-page">
      <div className="profile-grid" />
      <div className="profile-glow pg-1" />
      <div className="profile-glow pg-2" />

      <div className="profile-container">
        {/* 头部 */}
        <div className="profile-header">
          <h1 className="profile-title">编辑个人资料</h1>
          <Link to={backTarget} className="profile-back" onClick={handleBack}>&larr; {backLabel}</Link>
        </div>

        {/* 主题模式（浅色 / 深色 / 跟随系统，渐变切换） */}
        <div className="profile-theme">
          <span className="profile-theme-label">主题模式</span>
          <div className="profile-theme-toggle">
            {[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`profile-theme-option ${theme === v ? 'active' : ''}`}
                onClick={() => handleChangeTheme(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 头像预览 */}
        <div className="profile-avatar-section">
          <div className="profile-avatar-preview">
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" className="avatar-img" />
            ) : (
              <span className="avatar-letter">{getInitial(nickname || user.username)}</span>
            )}
          </div>
          <div className="profile-avatar-info">
            <p className="avatar-name">{nickname || user.username}</p>
            <p className="avatar-username">@{user.username}</p>
          </div>
        </div>

        {/* 表单 */}
        <div className="profile-form">
          {error && <div className="profile-error">{error}</div>}

          <div className="profile-field">
            <label className="profile-label">昵称</label>
            <input
              type="text"
              className="profile-input"
              placeholder="输入昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={50}
            />
          </div>

          <div className="profile-field">
            <label className="profile-label">头像链接</label>
            <input
              type="text"
              className="profile-input"
              placeholder="输入图片 URL（可选）"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              maxLength={500}
            />
            <p className="profile-field-hint">输入在线图片链接作为头像，留空使用默认首字母头像</p>
          </div>

          <button
            className="btn btn-primary profile-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>

          {saved && <div className="profile-success">&#10003; 保存成功</div>}

          {user.role === 'admin' && (
            <>
              <hr className="profile-divider" />
              <Link to="/admin" className="btn btn-primary profile-admin-btn">
                进入管理后台
              </Link>
            </>
          )}

          <hr className="profile-divider" />

          <button
            className="btn btn-danger profile-logout-btn"
            onClick={() => {
              localStorage.removeItem('token')
              localStorage.removeItem('user')
              navigate('/')
            }}
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProfileEdit
