import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './ProfileEdit.css'

const DEFAULT_AVATAR = ''

function ProfileEdit() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [nickname, setNickname] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    if (!token || !userStr) {
      navigate('/auth')
      return
    }
    const u = JSON.parse(userStr)
    setUser(u)
    setNickname(u.nickname || '')
    setAvatarUrl(u.avatar_url || '')
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

  return (
    <div className="profile-page">
      <div className="profile-grid" />
      <div className="profile-glow pg-1" />
      <div className="profile-glow pg-2" />

      <div className="profile-container">
        {/* 头部 */}
        <div className="profile-header">
          <Link to="/" className="profile-back">&larr; 返回首页</Link>
          <h1 className="profile-title">编辑个人资料</h1>
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
