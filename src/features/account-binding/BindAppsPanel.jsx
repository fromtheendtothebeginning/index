import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../../components/Modal'
import ActionButton from '../../components/ActionButton'
import { t } from '../../i18n'
import { apiFetch } from '../../utils/api'
import './BindAppsPanel.css'

/**
 * 「管理后台 → 绑定应用」面板：第三方项目绑定白名单。
 * 只有登记在此且处于启用状态的应用才能发起绑定；回调地址须与登记值精确一致。
 * GET/POST /api/admin/bind-apps · PUT/DELETE /api/admin/bind-apps/{id} · POST .../secret
 * client_secret 只在登记与重置时明文出现一次（后端只存 sha256）。
 */
const EMPTY_FORM = { name: '', description: '', homepage: '', redirectUris: '' }

export default function BindAppsPanel() {
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)
  const [apps, setApps] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)      // 编辑弹窗数据
  const [confirm, setConfirm] = useState(null)      // 删除确认
  const [credential, setCredential] = useState(null) // 一次性凭证弹窗
  const [copied, setCopied] = useState('')
  const copiedTimer = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(false)
    try {
      const res = await apiFetch('/api/admin/bind-apps')
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) { setLoadErr(true); return }
      setApps(body.apps || [])
    } catch {
      setLoadErr(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const copy = (text, key) => {
    const done = () => {
      setCopied(key)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(''), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => done())
    } else {
      done()
    }
  }

  const parseUris = (raw) => raw.split('\n').map(s => s.trim()).filter(Boolean)

  const handleCreate = async () => {
    setErr('')
    const uris = parseUris(form.redirectUris)
    if (!form.name.trim()) { setErr(t('binding.admin.nameRequired')); return }
    if (uris.length === 0) { setErr(t('binding.admin.urisRequired')); return }
    setBusy(true)
    try {
      const res = await apiFetch('/api/admin/bind-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          homepage: form.homepage.trim() || null,
          redirect_uris: uris,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(t('binding.admin.createFailed', { error: body?.detail || '' }))
        return
      }
      setForm(EMPTY_FORM)
      setCredential({ client_id: body.client_id, client_secret: body.client_secret, name: body.name })
      load()
    } catch {
      setErr(t('binding.admin.createFailed', { error: t('binding.admin.networkError') }))
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async () => {
    if (!editing) return
    const uris = parseUris(editing.redirectUris)
    if (!editing.name.trim()) { setErr(t('binding.admin.nameRequired')); return }
    if (uris.length === 0) { setErr(t('binding.admin.urisRequired')); return }
    setBusy(true)
    setErr('')
    try {
      const res = await apiFetch(`/api/admin/bind-apps/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.name.trim(),
          description: editing.description.trim() || null,
          homepage: editing.homepage.trim() || null,
          redirect_uris: uris,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(t('binding.admin.saveFailed', { error: body?.detail || '' }))
        return
      }
      setEditing(null)
      load()
    } catch {
      setErr(t('binding.admin.saveFailed', { error: t('binding.admin.networkError') }))
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (app) => {
    setErr('')
    try {
      const res = await apiFetch(`/api/admin/bind-apps/${app.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !app.is_active }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setErr(t('binding.admin.saveFailed', { error: body?.detail || '' }))
        return
      }
      load()
    } catch {
      setErr(t('binding.admin.saveFailed', { error: t('binding.admin.networkError') }))
    }
  }

  const rotateSecret = async (app) => {
    setErr('')
    try {
      const res = await apiFetch(`/api/admin/bind-apps/${app.id}/secret`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) {
        setErr(t('binding.admin.saveFailed', { error: body?.detail || '' }))
        return
      }
      setCredential({ client_id: body.client_id, client_secret: body.client_secret, name: app.name, rotated: true })
    } catch {
      setErr(t('binding.admin.saveFailed', { error: t('binding.admin.networkError') }))
    }
  }

  const removeApp = async (app) => {
    setConfirm(null)
    setErr('')
    try {
      const res = await apiFetch(`/api/admin/bind-apps/${app.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setErr(t('binding.admin.saveFailed', { error: body?.detail || '' }))
        return
      }
      load()
    } catch {
      setErr(t('binding.admin.saveFailed', { error: t('binding.admin.networkError') }))
    }
  }

  return (
    <section className="aba-panel">
      <div className="aba-head">
        <h2>{t('binding.admin.title')}</h2>
        <p className="aba-sub">{t('binding.admin.subtitle')}</p>
      </div>

      <div className="aba-form">
        <div className="aba-field">
          <input
            id="aba-app-name"
            type="text"
            placeholder=" "
            maxLength={50}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
          <label htmlFor="aba-app-name">{t('binding.admin.name')}</label>
        </div>
        <div className="aba-field">
          <input
            id="aba-app-desc"
            type="text"
            placeholder=" "
            maxLength={200}
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
          <label htmlFor="aba-app-desc">{t('binding.admin.description')}</label>
        </div>
        <div className="aba-field">
          <input
            id="aba-app-homepage"
            type="text"
            placeholder=" "
            maxLength={500}
            value={form.homepage}
            onChange={e => setForm({ ...form, homepage: e.target.value })}
          />
          <label htmlFor="aba-app-homepage">{t('binding.admin.homepage')}</label>
        </div>
        <div className="aba-field aba-form-uris">
          <textarea
            id="aba-app-uris"
            rows={3}
            placeholder=" "
            value={form.redirectUris}
            onChange={e => setForm({ ...form, redirectUris: e.target.value })}
          />
          <label htmlFor="aba-app-uris">{t('binding.admin.redirectUris')}</label>
        </div>
        <p className="aba-form-hint">{t('binding.admin.redirectHint')}</p>
        <div className="aba-form-ops">
          <ActionButton onClick={handleCreate} disabled={busy}>
            {busy ? t('binding.admin.saving') : t('binding.admin.create')}
          </ActionButton>
        </div>
      </div>

      {err && <div className="aba-err">{err}</div>}

      {loading ? (
        <div className="aba-loading">{t('binding.admin.loading')}</div>
      ) : loadErr ? (
        <div className="aba-err">
          {t('binding.admin.loadFailed')}
          <div className="aba-err-ops">
            <ActionButton size="sm" onClick={load}>{t('binding.admin.retry')}</ActionButton>
          </div>
        </div>
      ) : apps.length === 0 ? (
        <div className="aba-empty">{t('binding.admin.empty')}</div>
      ) : (
        <div className="aba-table">
          <div className="aba-row aba-row-head">
            <span>{t('binding.admin.colApp')}</span>
            <span>{t('binding.admin.colUris')}</span>
            <span>{t('binding.admin.colBound')}</span>
            <span>{t('binding.admin.colStatus')}</span>
            <span>{t('binding.admin.colActions')}</span>
          </div>
          {apps.map(app => (
            <div key={app.id} className="aba-row">
              <span className="aba-cell-app">
                <strong>{app.name}</strong>
                <em className="aba-mono">{app.client_id}</em>
              </span>
              <span className="aba-cell-uris">
                {app.redirect_uris.map(u => <em key={u} className="aba-mono">{u}</em>)}
              </span>
              <span className="aba-num">{app.bound_count}</span>
              <span className={`aba-status ${app.is_active ? '' : 'is-off'}`}>
                {app.is_active ? t('binding.admin.enabled') : t('binding.admin.disabled')}
              </span>
              <span className="aba-actions">
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing({
                    id: app.id,
                    name: app.name,
                    description: app.description || '',
                    homepage: app.homepage || '',
                    redirectUris: app.redirect_uris.join('\n'),
                  })}
                >
                  {t('binding.admin.edit')}
                </ActionButton>
                <ActionButton variant="secondary" size="sm" onClick={() => toggleActive(app)}>
                  {app.is_active ? t('binding.admin.disable') : t('binding.admin.enable')}
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirm({
                    app,
                    title: t('binding.admin.rotateTitle'),
                    message: t('binding.admin.rotateConfirm', { name: app.name }),
                    confirmText: t('binding.admin.rotate'),
                    onConfirm: () => { setConfirm(null); rotateSecret(app) },
                  })}
                >
                  {t('binding.admin.rotate')}
                </ActionButton>
                <ActionButton
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirm({
                    app,
                    title: t('binding.admin.deleteTitle'),
                    message: t('binding.admin.deleteConfirm', { name: app.name }),
                    confirmText: t('binding.admin.delete'),
                    onConfirm: () => removeApp(app),
                  })}
                >
                  {t('binding.admin.delete')}
                </ActionButton>
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="aba-hint">{t('binding.admin.docHint')}</p>

      {/* 编辑应用 */}
      <Modal
        open={!!editing}
        title={t('binding.admin.editTitle')}
        confirmText={busy ? t('binding.admin.saving') : t('binding.admin.save')}
        confirmDisabled={busy}
        onConfirm={handleUpdate}
        onCancel={() => { setEditing(null); setErr('') }}
      >
        {editing && (
          <>
            <div className="aba-field">
              <input
                id="aba-edit-name"
                type="text"
                placeholder=" "
                maxLength={50}
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
              />
              <label htmlFor="aba-edit-name">{t('binding.admin.name')}</label>
            </div>
            <div className="aba-field">
              <input
                id="aba-edit-desc"
                type="text"
                placeholder=" "
                maxLength={200}
                value={editing.description}
                onChange={e => setEditing({ ...editing, description: e.target.value })}
              />
              <label htmlFor="aba-edit-desc">{t('binding.admin.description')}</label>
            </div>
            <div className="aba-field">
              <input
                id="aba-edit-homepage"
                type="text"
                placeholder=" "
                maxLength={500}
                value={editing.homepage}
                onChange={e => setEditing({ ...editing, homepage: e.target.value })}
              />
              <label htmlFor="aba-edit-homepage">{t('binding.admin.homepage')}</label>
            </div>
            <div className="aba-field">
              <textarea
                id="aba-edit-uris"
                rows={3}
                placeholder=" "
                value={editing.redirectUris}
                onChange={e => setEditing({ ...editing, redirectUris: e.target.value })}
              />
              <label htmlFor="aba-edit-uris">{t('binding.admin.redirectUris')}</label>
            </div>
            <p className="aba-form-hint">{t('binding.admin.redirectHint')}</p>
          </>
        )}
      </Modal>

      {/* 删除确认 / 重置密钥确认 */}
      <Modal
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmText={confirm?.confirmText}
        danger
        onConfirm={() => confirm?.onConfirm?.()}
        onCancel={() => setConfirm(null)}
      />

      {/* 凭证（仅显示一次） */}
      <Modal
        open={!!credential}
        title={t('binding.admin.credentialTitle')}
        confirmText={t('binding.admin.credentialClose')}
        showCancel={false}
        onConfirm={() => setCredential(null)}
      >
        {credential && (
          <>
            <p className="aba-cred-warn">{t('binding.admin.credentialHint')}</p>
            {[
              ['client_id', credential.client_id],
              ['client_secret', credential.client_secret],
            ].map(([key, value]) => (
              <div key={key} className="aba-cred-row">
                <span className="aba-cred-key">{key}</span>
                <code className="aba-mono">{value}</code>
                <ActionButton size="sm" variant="secondary" onClick={() => copy(value, key)}>
                  {copied === key ? t('binding.admin.copied') : t('binding.admin.copy')}
                </ActionButton>
              </div>
            ))}
          </>
        )}
      </Modal>
    </section>
  )
}
