import { useCallback, useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import ActionButton from '../../components/ActionButton'
import { t } from '../../i18n'
import { apiFetch } from '../../utils/api'
import { fmtLocaleDateTime } from '../../utils/format'
import './BindingsPanel.css'

/**
 * 「我的 → 账号绑定」面板：查看并解除已绑定的第三方项目。
 * GET /api/bind/mine 列表；DELETE /api/bind/mine/{app_id} 解绑（撤销令牌，立即生效）。
 */
export default function BindingsPanel() {
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)
  const [bindings, setBindings] = useState([])
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(false)
    try {
      const res = await apiFetch('/api/bind/mine')
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) { setLoadErr(true); return }
      setBindings(body.bindings || [])
    } catch {
      setLoadErr(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const unbind = async (appId) => {
    setConfirm(null)
    try {
      const res = await apiFetch(`/api/bind/mine/${appId}`, { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice(t('binding.mine.unbindFailed', { error: body?.detail || '' }))
        return
      }
      setNotice(t('binding.mine.unbound'))
      load()
    } catch {
      setNotice(t('binding.mine.unbindFailed', { error: t('binding.mine.networkError') }))
    }
  }

  const fmt = (value) => (value ? fmtLocaleDateTime(value) : '—')

  return (
    <section className="abp-panel">
      <header className="abp-head">
        <h3 className="abp-title">{t('binding.mine.title')}</h3>
        <p className="abp-sub">{t('binding.mine.subtitle')}</p>
      </header>

      {loading ? (
        <div className="abp-loading">{t('binding.mine.loading')}</div>
      ) : loadErr ? (
        <div className="abp-err">
          {t('binding.mine.loadFailed')}
          <div className="abp-err-ops">
            <ActionButton size="sm" onClick={load}>{t('binding.mine.retry')}</ActionButton>
          </div>
        </div>
      ) : bindings.length === 0 ? (
        <div className="abp-empty">
          <p className="abp-empty-title">{t('binding.mine.empty')}</p>
          <p className="abp-empty-hint">{t('binding.mine.emptyHint')}</p>
        </div>
      ) : (
        <ul className="abp-list">
          {bindings.map(b => (
            <li key={b.app_id} className="abp-item">
              <div className="abp-item-main">
                <h4 className="abp-item-name">
                  {b.homepage
                    ? <a href={b.homepage} target="_blank" rel="noopener noreferrer">{b.name}</a>
                    : b.name}
                  <span className={`abp-status ${b.expired ? 'is-expired' : ''}`}>
                    {b.expired ? t('binding.mine.expired') : t('binding.mine.active')}
                  </span>
                </h4>
                {b.description && <p className="abp-item-desc">{b.description}</p>}
                <dl className="abp-meta">
                  <div>
                    <dt>{t('binding.mine.scope')}</dt>
                    <dd>{t('binding.mine.scopeProfile')}</dd>
                  </div>
                  <div>
                    <dt>{t('binding.mine.boundAt')}</dt>
                    <dd>{fmt(b.created_at)}</dd>
                  </div>
                  <div>
                    <dt>{t('binding.mine.lastUsed')}</dt>
                    <dd>{b.last_used_at ? fmt(b.last_used_at) : t('binding.mine.never')}</dd>
                  </div>
                  <div>
                    <dt>{t('binding.mine.expiresAt')}</dt>
                    <dd>{fmt(b.expires_at)}</dd>
                  </div>
                </dl>
              </div>
              <div className="abp-item-ops">
                <ActionButton
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirm(b)}
                >
                  {t('binding.mine.unbind')}
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className="abp-notice">{notice}</p>}

      <p className="abp-hint">{t('binding.mine.hint')}</p>

      <Modal
        open={!!confirm}
        title={t('binding.mine.unbindTitle')}
        message={t('binding.mine.unbindConfirm', { name: confirm?.name || '' })}
        confirmText={t('binding.mine.unbindConfirmText')}
        danger
        onConfirm={() => unbind(confirm.app_id)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  )
}
