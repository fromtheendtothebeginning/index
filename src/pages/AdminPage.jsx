import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import './AdminPage.css'

const CATEGORIES = ['技术讨论', '更新日志', '娱乐论坛']

function AdminPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [tab, setTab] = useState('users')
  const [authChecked, setAuthChecked] = useState(false)

  // 各 tab 数据
  const [users, setUsers] = useState([])
  const [comments, setComments] = useState([])
  const [blogs, setBlogs] = useState([])
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 弹窗
  const [modal, setModal] = useState(null) // { type, id, title, message, confirmText, onConfirm }

  // 新邀请码
  const [newCode, setNewCode] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userStr = localStorage.getItem('user')
    if (!token || !userStr) {
      navigate('/auth')
      return
    }
    const u = JSON.parse(userStr)
    if (u.role !== 'admin') {
      navigate('/profile')
      return
    }
    setUser(u)
    setAuthChecked(true)
  }, [navigate])

  const authHeaders = () => {
    const token = localStorage.getItem('token')
    return { Authorization: `Bearer ${token}` }
  }

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/users', { headers: authHeaders() })
      if (res.status === 403) { navigate('/profile'); return }
      const data = await res.json()
      setUsers(data.users || [])
    } catch { setError('网络错误') }
    finally { setLoading(false) }
  }, [navigate])

  const loadComments = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/comments', { headers: authHeaders() })
      const data = await res.json()
      setComments(data.comments || [])
    } catch { setError('网络错误') }
    finally { setLoading(false) }
  }, [])

  const loadBlogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/blogs', { headers: authHeaders() })
      const data = await res.json()
      setBlogs(data.blogs || [])
    } catch { setError('网络错误') }
    finally { setLoading(false) }
  }, [])

  const loadCodes = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/invite-codes', { headers: authHeaders() })
      const data = await res.json()
      setCodes(data.codes || [])
    } catch { setError('网络错误') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!authChecked) return
    if (tab === 'users') loadUsers()
    else if (tab === 'comments') loadComments()
    else if (tab === 'blogs') loadBlogs()
    else if (tab === 'codes') loadCodes()
  }, [authChecked, tab, loadUsers, loadComments, loadBlogs, loadCodes])

  // 设置角色
  const handleSetRole = async (userId, role) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.detail || '操作失败'); return }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
    } catch { alert('网络错误') }
  }

  // 删除评论
  const handleDeleteComment = async (commentId) => {
    if (!commentId) return
    try {
      const res = await fetch(`/api/admin/comments/${commentId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || '删除失败'); return }
      setComments(prev => prev.filter(c => c.id !== commentId))
    } catch { alert('网络错误') }
    finally { setModal(null) }
  }

  // 撤回博客
  const handleDeleteBlog = async (blogId) => {
    if (!blogId) return
    try {
      const res = await fetch(`/api/admin/blogs/${blogId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || '操作失败'); return }
      setBlogs(prev => prev.filter(b => b.id !== blogId))
    } catch { alert('网络错误') }
    finally { setModal(null) }
  }

  // 设置博客分类
  const handleSetCategory = async (blogId, category) => {
    try {
      const res = await fetch(`/api/admin/blogs/${blogId}/category`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ category: category || null }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.detail || '操作失败'); return }
      setBlogs(prev => prev.map(b => b.id === blogId ? { ...b, category: data.category } : b))
    } catch { alert('网络错误') }
  }

  // 生成邀请码
  const handleCreateCode = async () => {
    try {
      const res = await fetch('/api/admin/invite-codes', {
        method: 'POST',
        headers: authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.detail || '生成失败'); return }
      setNewCode(data.code)
      loadCodes()
    } catch { alert('网络错误') }
  }

  // 删除邀请码
  const handleDeleteCode = async (codeId) => {
    if (!codeId) return
    try {
      const res = await fetch(`/api/admin/invite-codes/${codeId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || '删除失败'); return }
      setCodes(prev => prev.filter(c => c.id !== codeId))
    } catch { alert('网络错误') }
    finally { setModal(null) }
  }

  // 切换可重复使用
  const handleToggleReusable = async (codeId, currentReusable) => {
    try {
      const res = await fetch(`/api/admin/invite-codes/${codeId}/reusable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ is_reusable: !currentReusable }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.detail || '操作失败'); return }
      setCodes(prev => prev.map(c => c.id === codeId ? { ...c, is_reusable: !currentReusable } : c))
    } catch { alert('网络错误') }
  }

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code).then(() => {
      alert(`已复制：${code}`)
    }).catch(() => {
      alert(`邀请码：${code}`)
    })
  }

  if (!authChecked) return null

  const fmtTime = (t) => new Date(t).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })

  return (
    <div className="admin-page">
      <Navbar activePage="" />
      <div className="admin-container">
        <div className="admin-header">
          <Link to="/profile" className="admin-back">&larr; 返回个人资料</Link>
          <h1 className="admin-title">管理后台</h1>
        </div>

        <div className="admin-tabs">
          <button className={`admin-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>用户管理</button>
          <button className={`admin-tab ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>评论管理</button>
          <button className={`admin-tab ${tab === 'blogs' ? 'active' : ''}`} onClick={() => setTab('blogs')}>博客管理</button>
          <button className={`admin-tab ${tab === 'codes' ? 'active' : ''}`} onClick={() => setTab('codes')}>邀请码</button>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {loading && <div className="admin-loading">加载中...</div>}

        {/* 用户管理 */}
        {tab === 'users' && !loading && (
          <div className="admin-section">
            <div className="admin-section-head">
              <h2>所有用户（{users.length}）</h2>
            </div>
            <div className="admin-table">
              <div className="admin-row admin-row-head">
                <span>ID</span>
                <span>用户名</span>
                <span>昵称</span>
                <span>角色</span>
                <span>注册时间</span>
                <span>操作</span>
              </div>
              {users.map(u => (
                <div key={u.id} className="admin-row">
                  <span>{u.id}</span>
                  <span className="admin-cell-user">{u.username}</span>
                  <span>{u.nickname || '-'}</span>
                  <span>
                    <span className={`role-badge ${u.role}`}>{u.role === 'admin' ? '管理员' : '普通用户'}</span>
                  </span>
                  <span className="admin-cell-time">{fmtTime(u.created_at)}</span>
                  <span>
                    {u.id !== user.id && (
                      <button
                        className="btn-role-toggle"
                        onClick={() => handleSetRole(u.id, u.role === 'admin' ? 'user' : 'admin')}
                      >
                        {u.role === 'admin' ? '降为普通用户' : '升为管理员'}
                      </button>
                    )}
                    {u.id === user.id && <span className="admin-self">（当前账户）</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 评论管理 */}
        {tab === 'comments' && !loading && (
          <div className="admin-section">
            <div className="admin-section-head">
              <h2>所有评论（{comments.length}）</h2>
            </div>
            {comments.length === 0 ? (
              <div className="admin-empty">暂无评论</div>
            ) : (
              <div className="admin-comment-list">
                {comments.map(c => (
                  <div key={c.id} className="admin-comment-item">
                    <div className="admin-comment-meta">
                      <span className="admin-comment-author">{c.user?.nickname || c.user?.username || '匿名'}</span>
                      <span className="admin-comment-blog">
                        <Link to={`/blogs/${c.blog_id}`} target="_blank">{c.blog_title || `#${c.blog_id}`}</Link>
                      </span>
                      <span className="admin-cell-time">{fmtTime(c.created_at)}</span>
                    </div>
                    <div className="admin-comment-content">{c.content}</div>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setModal({
                        id: c.id,
                        title: '删除评论',
                        message: '确认删除这条评论？删除后无法恢复。',
                        confirmText: '确认删除',
                        onConfirm: () => handleDeleteComment(c.id),
                      })}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 博客管理 */}
        {tab === 'blogs' && !loading && (
          <div className="admin-section">
            <div className="admin-section-head">
              <h2>所有博客（{blogs.length}）</h2>
            </div>
            {blogs.length === 0 ? (
              <div className="admin-empty">暂无博客</div>
            ) : (
              <div className="admin-table">
                <div className="admin-row admin-row-head">
                  <span>ID</span>
                  <span>标题</span>
                  <span>作者</span>
                  <span>分类</span>
                  <span>发布时间</span>
                  <span>操作</span>
                </div>
                {blogs.map(b => (
                  <div key={b.id} className="admin-row">
                    <span>{b.id}</span>
                    <span className="admin-cell-title">
                      <Link to={`/blogs/${b.id}`} target="_blank">{b.title}</Link>
                    </span>
                    <span>{b.author?.nickname || b.author?.username || '-'}</span>
                    <span>
                      <select
                        className="admin-category-select"
                        value={b.category || ''}
                        onChange={(e) => handleSetCategory(b.id, e.target.value)}
                      >
                        <option value="">未分类</option>
                        {CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </span>
                    <span className="admin-cell-time">{fmtTime(b.created_at)}</span>
                    <span>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => setModal({
                          id: b.id,
                          title: '撤回博客',
                          message: `确认撤回《${b.title}》？撤回后无法恢复。`,
                          confirmText: '确认撤回',
                          onConfirm: () => handleDeleteBlog(b.id),
                        })}
                      >
                        撤回
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 邀请码管理 */}
        {tab === 'codes' && !loading && (
          <div className="admin-section">
            <div className="admin-section-head">
              <h2>邀请码管理（{codes.length}）</h2>
              <button className="btn btn-primary btn-sm" onClick={handleCreateCode}>生成邀请码</button>
            </div>
            {newCode && (
              <div className="admin-new-code">
                <span>新邀请码：</span>
                <code className="admin-code-highlight">{newCode}</code>
                <button className="btn-copy" onClick={() => copyCode(newCode)}>复制</button>
              </div>
            )}
            {codes.length === 0 ? (
              <div className="admin-empty">暂无邀请码，点击上方按钮生成</div>
            ) : (
              <div className="admin-table">
                <div className="admin-row admin-row-head admin-row-codes">
                  <span>ID</span>
                  <span>邀请码</span>
                  <span>专属用户</span>
                  <span>已使用</span>
                  <span>可重复</span>
                  <span>生成时间</span>
                  <span>操作</span>
                </div>
                {codes.map(c => (
                  <div key={c.id} className="admin-row admin-row-codes">
                    <span>{c.id}</span>
                    <span><code className="admin-code">{c.code}</code></span>
                    <span>{c.owner_username ? c.owner_username : '-'}</span>
                    <span>
                      {c.is_used ? (
                        <span className="check-used" title="已使用">&#10003;</span>
                      ) : (
                        <span className="check-unused" title="未使用">&#9711;</span>
                      )}
                    </span>
                    <span>
                      <label className="reusable-toggle">
                        <input
                          type="checkbox"
                          checked={c.is_reusable}
                          onChange={() => handleToggleReusable(c.id, c.is_reusable)}
                        />
                        <span className="reusable-slider"></span>
                      </label>
                    </span>
                    <span className="admin-cell-time">{fmtTime(c.created_at)}</span>
                    <span className="admin-code-actions">
                      <button className="btn-copy" onClick={() => copyCode(c.code)}>复制</button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => setModal({
                          id: c.id,
                          title: '删除邀请码',
                          message: `确认删除邀请码 ${c.code}？删除后无法恢复。`,
                          confirmText: '确认删除',
                          onConfirm: () => handleDeleteCode(c.id),
                        })}
                      >
                        删除
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        open={!!modal}
        title={modal?.title || ''}
        message={modal?.message || ''}
        confirmText={modal?.confirmText || '确认'}
        danger
        onConfirm={() => modal?.onConfirm?.()}
        onCancel={() => setModal(null)}
      />
    </div>
  )
}

export default AdminPage
