import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { UiIcon } from '../components/Icons'
import CategoryDropdown from '../components/CategoryDropdown'
import Modal from '../components/Modal'
import { PROVIDERS, getProvider, getThinkingLevels, isValidThinkingLevel, AI_DEFAULTS } from '../utils/aiProviders'
import './MyPage.css'

const TYPE_META = {
  comment_reply: { icon: 'message', label: '回复' },
  comment_like: { icon: 'heart', label: '点赞' },
  blog_comment_like: { icon: 'thumb', label: '评论获赞' },
  project_new_blog: { icon: 'pin', label: '项目新博客' },
  blog_like: { icon: 'heart', label: '博客点赞' },
  blog_new_comment: { icon: 'message', label: '博客新评论' },
}

function MyPage() {
  const navigate = useNavigate()
  // 记住上次所在 tab（刷新后停留），网页刷新后依然在 AI 界面
  const [tab, setTab] = useState(() => localStorage.getItem('my_tab') || 'notify')

  const switchTab = (t) => {
    setTab(t)
    localStorage.setItem('my_tab', t)
  }

  // ── 通知 ──
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [badgeOn, setBadgeOn] = useState(localStorage.getItem('notify_badge_enabled') !== '0')

  // ── AI 设置 ──
  const [keys, setKeys] = useState([])
  const [currentKeyId, setCurrentKeyId] = useState(null)
  const [favorites, setFavorites] = useState([])
  const [customModels, setCustomModels] = useState([])
  const [dynModels, setDynModels] = useState([])
  const [model, setModel] = useState('')
  const [thinking, setThinking] = useState(AI_DEFAULTS.thinkingLevel)
  const [temperature, setTemperature] = useState(AI_DEFAULTS.temperature)
  const [topK, setTopK] = useState(AI_DEFAULTS.topK)
  const [aiLoading, setAiLoading] = useState(true)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [aiError, setAiError] = useState('')
  const [testResult, setTestResult] = useState(null)

  // ── 弹窗状态 ──
  const [addKeyOpen, setAddKeyOpen] = useState(false)
  const [newKey, setNewKey] = useState({ provider: 'deepseek', label: '', api_key: '', base_url: '' })
  const [savingKey, setSavingKey] = useState(false)
  const [editKeyTarget, setEditKeyTarget] = useState(null)
  const [editKey, setEditKey] = useState({ label: '', api_key: '', base_url: '' })
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const currentKey = keys.find(k => k.id === currentKeyId) || null
  const currentProv = useMemo(() => getProvider(currentKey ? currentKey.provider : 'deepseek'), [currentKey])

  // 可用模型 = 动态 + 自定义 去重合并
  const availableModels = useMemo(() => {
    const set = new Set()
    const merged = []
    dynModels.forEach(m => { if (!set.has(m)) { set.add(m); merged.push({ model: m, custom: false }) } })
    customModels.forEach(cm => { if (!set.has(cm.model)) { set.add(cm.model); merged.push({ model: cm.model, custom: true }) } })
    return merged
  }, [dynModels, customModels])

  // 排序：收藏置顶，其余按添加顺序
  const sortedModels = useMemo(() => {
    return [...availableModels].sort((a, b) => {
      const fa = favorites.includes(a.model) ? 1 : 0
      const fb = favorites.includes(b.model) ? 1 : 0
      return fb - fa
    })
  }, [availableModels, favorites])

  const handleToggleBadge = () => {
    const next = !badgeOn
    localStorage.setItem('notify_badge_enabled', next ? '1' : '0')
    window.dispatchEvent(new StorageEvent('storage', { key: 'notify_badge_enabled' }))
    setBadgeOn(next)
  }

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  })

  const handleAuthFail = (r) => {
    if (r.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      navigate('/auth')
      return true
    }
    return false
  }

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/auth')
      return
    }
    let cancelled = false
    setLoading(true)
    fetch('/api/notifications', { headers: authHeaders() })
      .then(r => {
        if (handleAuthFail(r)) return null
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (cancelled || !data) return
        setNotifications(data.notifications || [])
        setUnread(data.unread_count || 0)
      })
      .catch(() => setError('网络错误'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [navigate])

  // 加载 AI 设置
  useEffect(() => {
    if (!localStorage.getItem('token') || tab !== 'ai') return
    let cancelled = false
    setAiLoading(true)
    setAiError('')
    Promise.all([
      fetch('/api/user/ai-settings', { headers: authHeaders() }),
      fetch('/api/user/ai-keys', { headers: authHeaders() }),
      fetch('/api/user/ai-favorites', { headers: authHeaders() }),
      fetch('/api/user/ai-models', { headers: authHeaders() }),
    ])
      .then(async ([sRes, kRes, fRes, mRes]) => {
        const [s, k, f, m] = await Promise.all([sRes.json(), kRes.json(), fRes.json(), mRes.json()])
        if (cancelled) return
        setCurrentKeyId(s.key_id || null)
        setModel(s.model || '')
        setThinking(s.thinking_level || AI_DEFAULTS.thinkingLevel)
        setTemperature(typeof s.temperature === 'number' ? s.temperature : AI_DEFAULTS.temperature)
        setTopK(s.top_k || AI_DEFAULTS.topK)
        setKeys(k.keys || [])
        setFavorites(f.favorites || [])
        setCustomModels((m.models || []).map(mm => ({ model: mm })))
      })
      .catch(() => setAiError('网络错误，无法加载 AI 设置'))
      .finally(() => { if (!cancelled) setAiLoading(false) })
    return () => { cancelled = true }
  }, [tab])

  // 拉取动态模型（可复用：进入页面/切 key 自动，刷新按钮手动）
  // 先读 localStorage 缓存立即显示，再后台拉取更新并写缓存
  const loadModels = useCallback((keyId) => {
    if (!keyId) { setDynModels([]); return }
    const cacheKey = `ai_models_${keyId}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const arr = JSON.parse(cached)
        if (Array.isArray(arr) && arr.length > 0) setDynModels(arr)
      } catch { /* 缓存损坏忽略 */ }
    }
    setModelsLoading(true)
    fetch(`/api/user/ai-keys/${keyId}/models`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data) {
          setDynModels(data.models || [])
          if (data.models && data.models.length > 0) {
            try { localStorage.setItem(cacheKey, JSON.stringify(data.models)) } catch { /* 忽略 */ }
          }
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false))
  }, [])

  // 手动刷新：同时重新拉取动态模型 + 自定义模型（新增模型后靠此看到新模型）
  const refreshModels = useCallback((keyId) => {
    loadModels(keyId)
    if (currentKey) {
      fetch('/api/user/ai-models', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data) setCustomModels((data.models || []).map(mm => ({ model: mm }))) })
        .catch(() => {})
    }
  }, [loadModels, currentKey])

  // 当前 key 变化时拉取动态模型
  useEffect(() => {
    if (tab !== 'ai' || !currentKeyId) { setDynModels([]); return }
    loadModels(currentKeyId)
  }, [currentKeyId, tab, loadModels])

  // 思考深度按当前厂商+模型净化：切换 key/模型后若当前档位不在可选范围则重置
  useEffect(() => {
    if (!currentKey) return
    if (!isValidThinkingLevel(currentKey.provider, thinking, model)) {
      const levels = getThinkingLevels(currentKey.provider, model)
      const def = levels.find(t => t.value === AI_DEFAULTS.thinkingLevel)
      setThinking(def ? def.value : (levels[0] ? levels[0].value : AI_DEFAULTS.thinkingLevel))
    }
  }, [currentKeyId, currentKey, model])

  // ── Key 弹窗 ──

  const openAddKey = () => {
    setNewKey({ provider: 'deepseek', label: '', api_key: '', base_url: '' })
    setAiError('')
    setAddKeyOpen(true)
  }

  const handleAddKey = async () => {
    if (!newKey.api_key.trim()) { setAiError('请填写 API Key'); return }
    if (!getProvider(newKey.provider)) { setAiError('未知的提供商'); return }
    if (newKey.provider === 'custom' && !newKey.base_url.trim()) { setAiError('自定义提供商必须填写 Base URL'); return }
    setSavingKey(true)
    setAiError('')
    try {
      const res = await fetch('/api/user/ai-keys', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: newKey.provider,
          api_key: newKey.api_key.trim(),
          label: newKey.label.trim(),
          custom_base_url: newKey.base_url.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setAiError(data.detail || '添加失败'); return }
      setKeys(ks => [...ks, data])
      if (!currentKeyId) setCurrentKeyId(data.id)
      setAddKeyOpen(false)
    } catch {
      setAiError('网络错误，请稍后重试')
    } finally {
      setSavingKey(false)
    }
  }

  const openEditKey = (k) => {
    setEditKeyTarget(k)
    setEditKey({ label: k.label || '', api_key: '', base_url: k.custom_base_url || '' })
    setAiError('')
  }

  const handleSaveEditKey = async () => {
    if (!editKeyTarget) return
    setAiError('')
    try {
      const body = { label: editKey.label.trim() }
      if (editKey.base_url.trim()) body.custom_base_url = editKey.base_url.trim()
      if (editKey.api_key.trim()) body.api_key = editKey.api_key.trim()
      const res = await fetch(`/api/user/ai-keys/${editKeyTarget.id}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setAiError(data.detail || '保存失败'); return }
      setKeys(ks => ks.map(x => (x.id === editKeyTarget.id ? data : x)))
      setEditKeyTarget(null)
    } catch {
      setAiError('网络错误，请稍后重试')
    }
  }

  const openDeleteKey = (k) => {
    setDeleteTarget(k)
    setAiError('')
  }

  const handleDeleteKey = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setAiError('')
    try {
      const res = await fetch(`/api/user/ai-keys/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) { setAiError('删除失败'); setDeleting(false); return }
      setKeys(ks => ks.filter(x => x.id !== deleteTarget.id))
      if (currentKeyId === deleteTarget.id) { setCurrentKeyId(null); setDynModels([]) }
      setDeleteTarget(null)
    } catch {
      setAiError('网络错误，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }

  const handleSetCurrentKey = (keyId) => {
    setCurrentKeyId(keyId)
    fetch('/api/user/ai-settings', {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_id: keyId, model: model.trim() || null, thinking_level: thinking, temperature, top_k: topK }),
    }).catch(() => {})
  }

  // ── 模型弹窗 ──

  const openAddModel = () => {
    setNewModelName('')
    setAiError('')
    setAddModelOpen(true)
  }

  const handleAddModel = async () => {
    const name = newModelName.trim()
    if (!name) return
    if (!currentKey) { setAiError('请先选择或添加一个 Key'); return }
    setAiError('')
    try {
      const res = await fetch('/api/user/ai-models', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: currentKey.provider, model: name }),
      })
      const data = await res.json()
      if (!res.ok) { setAiError(data.detail || '添加失败'); return }
      // 新增成功后不自动刷新列表，由用户点「刷新」后手动看到新模型
      setAddModelOpen(false)
    } catch {
      setAiError('网络错误，请稍后重试')
    }
  }

  const handleToggleFavorite = async (m) => {
    const wasFav = favorites.includes(m.model)
    const newFavs = wasFav ? favorites.filter(f => f !== m.model) : [...favorites, m.model]
    setFavorites(newFavs)
    try {
      const res = await fetch('/api/user/ai-favorites/toggle', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: currentKey.provider, model: m.model }),
      })
      const data = await res.json()
      if (data && data.favorites) setFavorites(data.favorites)
    } catch {
      setFavorites(wasFav ? [...favorites, m.model] : favorites.filter(f => f !== m.model))
    }
  }

  const handleRemoveCustomModel = async (m) => {
    if (!currentKey) return
    setAiError('')
    try {
      const res = await fetch('/api/user/ai-models', {
        method: 'DELETE',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: currentKey.provider, model: m.model }),
      })
      const data = await res.json()
      if (!res.ok) { setAiError(data.detail || '删除失败'); return }
      setCustomModels(data.models.map(mm => ({ model: mm })))
    } catch {
      setAiError('网络错误，请稍后重试')
    }
  }

  // ── 保存 / 测试 ──

  const handleSaveAi = async () => {
    setSavingAi(true)
    setAiError('')
    setAiSaved(false)
    setTestResult(null)
    try {
      const body = { thinking_level: thinking, temperature, top_k: topK, model: model.trim() || null }
      if (currentKeyId) body.key_id = currentKeyId
      const res = await fetch('/api/user/ai-settings', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setAiError(data.detail || '保存失败'); return }
      setAiSaved(true)
      setTimeout(() => setAiSaved(false), 2500)
    } catch {
      setAiError('网络错误，请稍后重试')
    } finally {
      setSavingAi(false)
    }
  }

  const handleTestAi = async () => {
    if (!currentKeyId) { setTestResult({ ok: false, text: '请先选择一个 Key' }); return }
    setTestingAi(true)
    setAiError('')
    setTestResult(null)
    try {
      const body = {}
      if (model.trim()) body.model = model.trim()
      const res = await fetch('/api/user/ai-settings/test', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setAiError(data.detail || '测试失败'); return }
      setTestResult({
        ok: data.ok,
        text: data.ok
          ? `连接成功（${data.latency_ms}ms）`
          : `连接失败：${data.error || '未知错误'}`,
      })
    } catch {
      setTestResult({ ok: false, text: '网络错误，请稍后重试' })
    } finally {
      setTestingAi(false)
    }
  }

  const handleReadAll = async () => {
    try {
      await fetch('/api/notifications/read', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      setNotifications(ns => ns.map(n => ({ ...n, is_read: true })))
      setUnread(0)
    } catch { /* 网络错误静默处理 */ }
  }

  const handleClick = (n) => {
    if (!n.blog_id) return
    if (!n.is_read) {
      fetch('/api/notifications/read', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => {})
      setNotifications(ns => ns.map(x => (x.id === n.id ? { ...x, is_read: true } : x)))
      setUnread(u => Math.max(0, u - 1))
    }
    navigate(`/blogs/${n.blog_id}`)
  }

  const formatTime = (s) => (s ? new Date(s).toLocaleString('zh-CN') : '')

  return (
    <div className="my-page">
      <Navbar activePage="my" />
      <div className="my-container">
        <div className="my-header">
          <h1 className="my-title">我的</h1>
          <div className="my-tabs">
            <button type="button" className={`my-tab ${tab === 'notify' ? 'active' : ''}`} onClick={() => switchTab('notify')}>
              通知{unread > 0 && <span className="my-tab-badge">{unread}</span>}
            </button>
            <button type="button" className={`my-tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => switchTab('ai')}>
              AI 设置
            </button>
          </div>
        </div>

        {tab === 'notify' && (
          <>
            <div className="my-subheader">
              <label className="my-badge-toggle">
                <input type="checkbox" checked={badgeOn} onChange={handleToggleBadge} />
                <span>未读红点</span>
              </label>
              {unread > 0 && <span className="my-unread-count">{unread} 条未读</span>}
              <button className="btn btn-sm my-read-all" onClick={handleReadAll}>全部已读</button>
            </div>
            {error && <div className="my-error">{error}</div>}
            {loading ? (
              <div className="my-loading">加载中...</div>
            ) : notifications.length === 0 ? (
              <div className="my-empty">暂无通知</div>
            ) : (
              <ul className="my-list">
                {notifications.map((n, i) => {
                  const meta = TYPE_META[n.type] || { icon: '•', label: n.type }
                  return (
                    <li
                      key={n.id}
                      className={`my-item ${n.is_read ? '' : 'my-item-unread'} ${n.blog_id ? 'my-item-link' : ''}`}
                      onClick={() => handleClick(n)}
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <span className="my-item-icon" title={meta.label}><UiIcon name={meta.icon} size={15} /></span>
                      <div className="my-item-main">
                        <p className="my-item-content">{n.content}</p>
                        <p className="my-item-meta">
                          {n.actor_username && <span className="my-item-actor">{n.actor_username}</span>}
                          <span className="my-item-time">{formatTime(n.created_at)}</span>
                        </p>
                      </div>
                      {!n.is_read && <span className="my-item-dot" />}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {tab === 'ai' && (
          <div className="ai-settings">
            {aiLoading ? (
              <div className="my-loading">加载中...</div>
            ) : (
              <>
                {aiError && <div className="my-error">{aiError}</div>}

                {/* ═══ Key 管理 ═══ */}
                <div className="ai-section">
                  <div className="ai-section-head">
                    <span className="ai-section-title">API Key 管理</span>
                    <button className="btn btn-sm" onClick={openAddKey}>+ 新增 Key</button>
                  </div>

                  {keys.length === 0 ? (
                    <div className="my-empty">还没有 API Key，点击「新增 Key」添加</div>
                  ) : (
                    <div className="ai-key-list">
                      {keys.map(k => (
                        <div key={k.id} className={`ai-key-item ${k.id === currentKeyId ? 'active' : ''}`}>
                          <div className="ai-key-main">
                            <div className="ai-key-top">
                              <span className="ai-key-provider">{getProvider(k.provider)?.label || k.provider}</span>
                              {k.label && <span className="ai-key-label">{k.label}</span>}
                              {k.id === currentKeyId && <span className="ai-key-current">当前使用</span>}
                            </div>
                            <div className="ai-key-meta">
                              <span className="ai-key-hint">{k.key_hint || '无 Key'}</span>
                              {k.custom_base_url && <span className="ai-key-url">{k.custom_base_url}</span>}
                            </div>
                          </div>
                          <div className="ai-key-ops">
                            {k.id !== currentKeyId && (
                              <button className="ai-op-btn" title="设为当前" onClick={() => handleSetCurrentKey(k.id)}>
                                <UiIcon name="check" size={14} />
                              </button>
                            )}
                            <button className="ai-op-btn" title="编辑" onClick={() => openEditKey(k)}>
                              <UiIcon name="edit" size={14} />
                            </button>
                            <button className="ai-op-btn danger" title="删除" onClick={() => openDeleteKey(k)}>
                              <UiIcon name="trash" size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ═══ 选择当前模型（点击可用模型项）═══ */}
                <div className="ai-section">
                  <div className="ai-section-head">
                    <span className="ai-section-title">选择当前模型</span>
                    {currentProv && <span className="ai-key-provider">{currentProv.label}</span>}
                    <div className="ai-section-ops">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => refreshModels(currentKeyId)}
                        disabled={modelsLoading || !currentKeyId}
                        title="刷新可用模型"
                      >
                        {modelsLoading ? '加载中...' : '刷新'}
                      </button>
                      <button className="btn btn-sm" onClick={openAddModel}>+ 新增模型</button>
                    </div>
                  </div>

                  {!currentKeyId ? (
                    <div className="my-empty">请先在「API Key 管理」选择或添加一个 Key</div>
                  ) : (
                    <>
                      <p className="ai-hint">收藏的模型排在最前，其余按添加时间排序；点星标收藏/取消</p>
                      {sortedModels.length === 0 ? (
                        <div className="my-empty">
                          {modelsLoading ? '正在查询可用模型...' : '暂无可用模型，可手动新增'}
                        </div>
                      ) : (
                        <ul className="ai-model-list">
                          {sortedModels.map(m => (
                            <li key={m.model} className={`ai-model-item ${model === m.model ? 'active' : ''}`}>
                              <button
                                type="button"
                                className="ai-model-name"
                                onClick={() => setModel(m.model)}
                                title="点击设为当前模型"
                              >
                                {m.model}
                                {m.custom && <span className="ai-model-tag">自定义</span>}
                              </button>
                              <div className="ai-model-ops">
                                <button
                                  type="button"
                                  className={`ai-fav-btn ${favorites.includes(m.model) ? 'active' : ''}`}
                                  title={favorites.includes(m.model) ? '取消收藏' : '收藏'}
                                  onClick={() => handleToggleFavorite(m)}
                                >
                                  <UiIcon name="star" size={14} filled={favorites.includes(m.model)} />
                                </button>
                                {m.custom && (
                                  <button type="button" className="ai-op-btn danger" title="移除" onClick={() => handleRemoveCustomModel(m)}>
                                    <UiIcon name="trash" size={14} />
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>

                {/* ═══ 采样参数（先选模型后呈现）═══ */}
                {model ? (
                  <div className="ai-section">
                    <div className="ai-section-head">
                      <span className="ai-section-title">采样参数</span>
                      <span className="ai-section-sub">当前模型：{model}</span>
                    </div>

                    <div className="ai-field">
                      <label className="ai-label">思考深度</label>
                      <CategoryDropdown
                        value={thinking}
                        onChange={setThinking}
                        options={getThinkingLevels(currentKey ? currentKey.provider : 'deepseek', model).map(t => ({ value: t.value, label: t.label }))}
                        placeholder="选择思考深度"
                        hideClear
                        closeOnSelect
                      />
                      <p className="ai-hint">根据所选厂商支持的思考档位调整</p>
                    </div>

                    {getProvider(currentKey ? currentKey.provider : 'deepseek')?.sampling !== false && (
                      <>
                        <div className="ai-field">
                          <label className="ai-label">
                            温度 Temperature
                            <span className="ai-value">{temperature.toFixed(2)}</span>
                          </label>
                          <input
                            type="range"
                            className="ai-range"
                            min="0" max="2" step="0.05"
                            value={temperature}
                            onChange={(e) => setTemperature(parseFloat(e.target.value))}
                          />
                          <p className="ai-hint">越低越确定，越高越发散（默认 0.7）</p>
                        </div>

                        <div className="ai-field">
                          <label className="ai-label">
                            Top-K
                            <span className="ai-value">{topK}</span>
                          </label>
                          <input
                            type="range"
                            className="ai-range"
                            min="1" max="100" step="1"
                            value={topK}
                            onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                          />
                          <p className="ai-hint">采样时考虑的候选数量（默认 40）</p>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="ai-section">
                    <div className="my-empty">请先在「选择当前模型」中点击一个模型，再设置采样参数</div>
                  </div>
                )}

                <div className="ai-actions">
                  <button className="btn btn-primary" onClick={handleSaveAi} disabled={savingAi}>
                    {savingAi ? '保存中...' : '保存设置'}
                  </button>
                  <button className="btn btn-secondary" onClick={handleTestAi} disabled={testingAi}>
                    {testingAi ? '测试中...' : '测试连接'}
                  </button>
                </div>

                {aiSaved && <div className="profile-success ai-saved">&#10003; 已保存</div>}
                {testResult && (
                  <div className={`ai-test ${testResult.ok ? 'ok' : 'err'}`}>{testResult.text}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ═══ 二级弹窗（新增/编辑 Key）═══ */}
      <Modal open={addKeyOpen} title="新增 API Key" confirmText="添加" onCancel={() => setAddKeyOpen(false)} onConfirm={handleAddKey} confirmDisabled={savingKey}>
        <div className="ai-modal-field">
          <label className="ai-label">AI 提供商</label>
          <CategoryDropdown
            value={newKey.provider}
            onChange={(v) => setNewKey({ ...newKey, provider: v })}
            options={PROVIDERS.map(p => ({ value: p.id, label: p.label }))}
            placeholder="选择提供商"
            hideClear
          />
        </div>
        <div className="ai-modal-field">
          <label className="ai-label">API Key</label>
          <input
            type="password"
            className="profile-input ai-input"
            placeholder="输入 API Key *"
            value={newKey.api_key}
            onChange={(e) => setNewKey({ ...newKey, api_key: e.target.value })}
            maxLength={300}
            autoComplete="off"
          />
        </div>
        <div className="ai-modal-field">
          <label className="ai-label">备注名</label>
          <input
            type="text"
            className="profile-input ai-input"
            placeholder="可选，如「工作账号」"
            value={newKey.label}
            onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
            maxLength={50}
          />
        </div>
        {newKey.provider === 'custom' && (
          <div className="ai-modal-field">
            <label className="ai-label">Base URL（必填）</label>
            <input
              type="text"
              className="profile-input ai-input"
              placeholder="如 https://my-custom-endpoint.com/v1"
              value={newKey.base_url}
              onChange={(e) => setNewKey({ ...newKey, base_url: e.target.value })}
              maxLength={500}
            />
          </div>
        )}
        {aiError && addKeyOpen && <div className="ai-modal-err">{aiError}</div>}
      </Modal>

      <Modal open={!!editKeyTarget} title={`编辑 Key${editKeyTarget ? (editKeyTarget.label ? `「${editKeyTarget.label}」` : '') : ''}`} confirmText="保存" onCancel={() => setEditKeyTarget(null)} onConfirm={handleSaveEditKey}>
        <div className="ai-modal-field">
          <label className="ai-label">备注名</label>
          <input
            type="text"
            className="profile-input ai-input"
            placeholder="备注名"
            value={editKey.label}
            onChange={(e) => setEditKey({ ...editKey, label: e.target.value })}
            maxLength={50}
          />
        </div>
        <div className="ai-modal-field">
          <label className="ai-label">API Key</label>
          <input
            type="password"
            className="profile-input ai-input"
            placeholder={editKeyTarget?.key_hint ? `已保存 ${editKeyTarget.key_hint}，输入新 Key 覆盖` : 'API Key'}
            value={editKey.api_key}
            onChange={(e) => setEditKey({ ...editKey, api_key: e.target.value })}
            maxLength={300}
            autoComplete="off"
          />
        </div>
        {editKeyTarget?.provider === 'custom' && (
          <div className="ai-modal-field">
            <label className="ai-label">Base URL</label>
            <input
              type="text"
              className="profile-input ai-input"
              placeholder="Base URL"
              value={editKey.base_url}
              onChange={(e) => setEditKey({ ...editKey, base_url: e.target.value })}
              maxLength={500}
            />
          </div>
        )}
        {aiError && editKeyTarget && <div className="ai-modal-err">{aiError}</div>}
      </Modal>

      <Modal open={addModelOpen} title="新增模型" confirmText="添加" onCancel={() => setAddModelOpen(false)} onConfirm={handleAddModel}>
        <div className="ai-modal-field">
          <label className="ai-label">模型 ID</label>
          <input
            type="text"
            className="profile-input ai-input"
            placeholder="如 my-custom-v1"
            value={newModelName}
            onChange={(e) => setNewModelName(e.target.value)}
            maxLength={100}
            autoFocus
          />
          <p className="ai-hint">手动添加一个模型到「可用模型」列表，供当前 Key 选择</p>
        </div>
        {aiError && addModelOpen && <div className="ai-modal-err">{aiError}</div>}
      </Modal>

      <Modal
        open={!!deleteTarget}
        title="删除 API Key"
        message={`确定删除 Key「${deleteTarget ? (deleteTarget.label || deleteTarget.key_hint || deleteTarget.id) : ''}」？此操作不可撤销。`}
        confirmText="删除"
        cancelText="取消"
        danger
        confirmDisabled={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteKey}
      />
    </div>
  )
}

export default MyPage
