import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Modal from '../components/Modal'
import { UiIcon } from '../components/Icons'
import './LeetCodePage.css'

const MEDAL_COLORS = { 0: 'lc-medal-gold', 1: 'lc-medal-silver', 2: 'lc-medal-bronze' }

const Avatar = ({ user, size = 28 }) => {
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt="" className="lc-avatar" style={{ width: size, height: size }} />
  }
  const name = user.nickname || user.username || '?'
  return (
    <span className="lc-avatar lc-avatar-letter" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

function LeetCodePage() {
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [me, setMe] = useState(null)
  const [lcUsername, setLcUsername] = useState('')
  const [lcSaving, setLcSaving] = useState(false)
  const [lcError, setLcError] = useState('')
  const [unbindOpen, setUnbindOpen] = useState(false)
  const [unbindText, setUnbindText] = useState('')
  const [unbinding, setUnbinding] = useState(false)
  const [boostConfirm, setBoostConfirm] = useState(false)
  const [boostExitConfirm, setBoostExitConfirm] = useState(false)

const CACHE_KEY = 'lc_me_cache'

const lcHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

const loadLc = () => {
  fetch('/api/leetcode/me', { headers: lcHeaders() })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d) return
      setMe(d)
      localStorage.setItem(CACHE_KEY, JSON.stringify(d))
    })
    .catch(() => {})
}

const load = () => {
  fetch('/api/leetcode/leaderboard')
    .then(r => r.json())
    .then(d => setBoard(d))
    .catch(() => {})
    .finally(() => setLoading(false))
}

useEffect(() => {
  load()
  // 先渲染本地缓存的绑定状态，避免切换页面时闪出绑定表单（实时同步 LeetCode 需 1-3s）
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (cached && cached.bound) setMe(cached)
  } catch {}
  loadLc()
}, [])

  const handleBind = async () => {
    const name = lcUsername.trim()
    if (!name) { setLcError('请输入 LeetCode 用户名'); return }
    setLcSaving(true)
    setLcError('')
    try {
      const res = await fetch('/api/leetcode/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...lcHeaders() },
        body: JSON.stringify({ leetcode_username: name }),
      })
      const d = await res.json()
      if (!res.ok) { setLcError(d.detail || '绑定失败'); return }
      setMe(d)
      setLcUsername('')
      load()
    } catch { setLcError('网络错误') }
    finally { setLcSaving(false) }
  }

  const handleUnbind = async () => {
    if (unbindText.trim() !== '确认解绑') return
    setUnbinding(true)
    try {
      const res = await fetch('/api/leetcode/me', { method: 'DELETE', headers: lcHeaders() })
      if (res.ok) {
        setMe(null)
        localStorage.removeItem(CACHE_KEY)
        setUnbindOpen(false)
        setUnbindText('')
        load()
      }
    } catch {}
    finally { setUnbinding(false) }
  }

  const handleMode = async (patch) => {
    try {
      const res = await fetch('/api/leetcode/me/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...lcHeaders() },
        body: JSON.stringify(patch),
      })
      const d = await res.json()
      if (res.ok && d) { setMe(d); load() }
    } catch {}
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetch('/api/leetcode/refresh', { method: 'POST' })
    } catch {}
    load()
    setRefreshing(false)
  }

  const users = board?.users || []
  const localUser = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
  })()
  const myRow = me && me.bound && localUser ? users.find(u => u.user_id === localUser.id) : null
  const myRank = myRow ? users.findIndex(u => u.user_id === myRow.user_id) : -1

  const meCard = (
    <div className={`lc-mine ${me && me.bound ? 'lc-mine-ranked' : ''}`}>
      {!me || !me.bound ? (
        <div className="lc-bind-box">
          <div className="lc-bind-head">
            <span className="lc-mine-label">绑定 LeetCode 账号</span>
            {lcError && <span className="lc-bind-error">{lcError}</span>}
          </div>
          <p className="lc-bind-hint">
            绑定 leetcode.cn 账号后，榜单将展示你从绑定时刻起的刷题增量（简单 2 分 / 中等 4 分 / 困难 8 分）
          </p>
          <div className="lc-bind-row">
            <input
              type="text"
              className="lc-bind-input"
              placeholder="LeetCode 用户名"
              value={lcUsername}
              onChange={e => setLcUsername(e.target.value)}
              maxLength={100}
            />
            <button className="btn btn-primary lc-bind-btn" onClick={handleBind} disabled={lcSaving}>
              {lcSaving ? '绑定中...' : '绑定'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <span className="lc-mine-label">我的排名</span>
          <span className="lc-mine-rank">#{myRank >= 0 ? myRank + 1 : '-'}</span>
          <span className="lc-mine-user">
            <Avatar user={{ avatar_url: myRow ? myRow.avatar_url : null, nickname: myRow ? myRow.nickname : null, username: myRow ? myRow.username : null }} />
            <span className="lc-nickname">{myRow ? (myRow.nickname || myRow.username) : me.leetcode_username}</span>
            <span className="lc-username">@{me.leetcode_username}</span>
            {me.difficulty_mode && (
              <span className="lc-hard-tag" title="困难模式下得分减半">困难模式</span>
            )}
            {me.serious_mode && (
              <span className="lc-serious-tag" title="严肃模式下简单题不计入分数">严肃模式</span>
            )}
            {me.boost_mode && (
              <span className="lc-boost-tag" title="激励模式：初始 -100 分，3/6/9 计分">激励模式</span>
            )}
          </span>
          <span className="lc-mine-stats">
            简单 {me.inc.easy} · 中等 {me.inc.medium} · 困难 {me.inc.hard} · 总增量 {me.total_inc}
          </span>
          <span className="lc-mine-score">{me.score} 分</span>
          <div className="lc-mine-actions">
            <label className="lc-mode-toggle" title="困难模式下得分减半">
              <input
                type="checkbox"
                checked={!!me.difficulty_mode}
                onChange={e => handleMode({ difficulty_mode: e.target.checked })}
              />
              困难模式
            </label>
            <label className="lc-mode-toggle" title="严肃模式下简单题不计入分数">
              <input
                type="checkbox"
                checked={!!me.serious_mode}
                onChange={e => handleMode({ serious_mode: e.target.checked })}
              />
              严肃模式
            </label>
            <label className="lc-mode-toggle" title="激励模式：初始 -100 分，简单 3 分 / 中等 6 分 / 困难 9 分，与困难/严肃模式互斥">
              <input
                type="checkbox"
                checked={!!me.boost_mode}
                onChange={e => {
                  if (e.target.checked) setBoostConfirm(true)
                  else setBoostExitConfirm(true)
                }}
              />
              激励模式
            </label>
            <button className="lc-unbind-btn" onClick={() => setUnbindOpen(true)}>解绑</button>
          </div>
          {unbindOpen && (
            <div className="lc-unbind-confirm">
              <p className="lc-unbind-tip">解绑后榜单将不再展示你的刷题量，且重新绑定将重新计算（从新绑定时刻起算）。输入「确认解绑」以解绑：</p>
              <div className="lc-unbind-row">
                <input
                  type="text"
                  className="lc-bind-input"
                  placeholder="确认解绑"
                  value={unbindText}
                  onChange={e => setUnbindText(e.target.value)}
                />
                <button
                  className="btn btn-danger lc-unbind-confirm-btn"
                  disabled={unbindText.trim() !== '确认解绑' || unbinding}
                  onClick={handleUnbind}
                >
                  {unbinding ? '解绑中...' : '确认解绑'}
                </button>
                <button
                  className="lc-unbind-cancel"
                  onClick={() => { setUnbindOpen(false); setUnbindText('') }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="lc-page">
      <Navbar activePage="leetcode" />
      <div className="lc-main">
        <div className="lc-header">
          <h1 className="lc-title">LeetCode 刷题榜</h1>
          <p className="lc-subtitle">
            绑定 LeetCode 账号后的刷题量 · 简单 2 分 / 中等 4 分 / 困难 8 分 · 困难模式减半 · 严肃模式简单不计分 · 激励模式初始 -100 分（3/6/9）
          </p>
        </div>

        <div className="lc-toolbar">
          <button className="btn btn-primary lc-refresh-btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? '同步中...' : '刷新数据'}
          </button>
          <span className="lc-updated">
            {board ? `更新于 ${new Date(board.generated_at).toLocaleString('zh-CN')}` : ''}
          </span>
        </div>

        {meCard}

        {loading ? (
          <div className="lc-loading">加载中...</div>
        ) : users.length === 0 ? (
          <div className="lc-empty">
            <p>暂无用户绑定 LeetCode</p>
          </div>
        ) : (
          <div className="lc-board">
            <div className="lc-row lc-row-head">
              <span className="lc-col-rank">排名</span>
              <span className="lc-col-user">用户</span>
              <span className="lc-col-stat">简单</span>
              <span className="lc-col-stat">中等</span>
              <span className="lc-col-stat">困难</span>
              <span className="lc-col-stat">总数</span>
              <span className="lc-col-score">得分</span>
            </div>
            {users.map((u, i) => (
              <div
                key={u.user_id}
                className={`lc-row ${u.difficulty_mode ? 'lc-row-hard' : ''} ${me && me.bound && localUser && u.user_id === localUser.id ? 'lc-row-self' : ''}`}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="lc-col-rank">
                  {i < 3 ? (
                    <span className={`lc-medal ${MEDAL_COLORS[i]}`} title={`第 ${i + 1} 名`}>
                      <UiIcon name="medal" size={20} />
                    </span>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="lc-col-user">
                  <Avatar user={u} />
                  <span className="lc-nickname">{u.nickname || u.username}</span>
                  <span className="lc-username">@{u.leetcode_username}</span>
                  {u.difficulty_mode && (
                    <span className="lc-hard-tag" title="困难模式下得分减半">困难模式</span>
                  )}
                  {u.serious_mode && (
                    <span className="lc-serious-tag" title="严肃模式下简单题不计入分数">严肃模式</span>
                  )}
                  {u.boost_mode && (
                    <span className="lc-boost-tag" title="激励模式：初始 -100 分，3/6/9 计分">激励模式</span>
                  )}
                </span>
                <span className="lc-col-stat">{u.easy}</span>
                <span className="lc-col-stat">{u.medium}</span>
                <span className="lc-col-stat">{u.hard}</span>
                <span className="lc-col-stat">{u.total}</span>
                <span className="lc-col-score">{u.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={boostConfirm}
        title="开启激励模式"
        message="开启激励模式后将清零当前刷题量（已自动备份），退出激励模式时自动恢复。激励模式初始 -100 分，简单 3 分 / 中等 6 分 / 困难 9 分，且与困难、严肃模式互斥。确定开启？"
        confirmText="确认开启"
        danger
        onConfirm={() => {
          setBoostConfirm(false)
          handleMode({ boost_mode: true })
        }}
        onCancel={() => setBoostConfirm(false)}
      />
      <Modal
        open={boostExitConfirm}
        title="退出激励模式"
        message="退出激励模式后将恢复之前备份的刷题量（含激励期间新刷的题一并算回），并恢复普通计分（简单 2 / 中等 4 / 困难 8）。确定退出？"
        confirmText="确认退出"
        danger
        onConfirm={() => {
          setBoostExitConfirm(false)
          handleMode({ boost_mode: false })
        }}
        onCancel={() => setBoostExitConfirm(false)}
      />
    </div>
  )
}

export default LeetCodePage
