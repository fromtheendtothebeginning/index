import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import { UiIcon } from '../../components/Icons'
import { t } from '../../i18n'
import '../../pages/ToolParsePage.css'
import './BindConsentPage.css'

/**
 * 授权确认页 —— 第三方项目绑定 anticraft 账号的授权入口。
 *
 * 第三方把用户浏览器送到 /bind?client_id=..&redirect_uri=..&state=..
 *   未登录 → 提示先登录；未在白名单 / 回调地址不符 → 直接拒绝（后端校验）。
 *   确认后 → 后端下发一次性 code，本页把浏览器带回 redirect_uri?code=..&state=..
 *            第三方服务端再用 code 换访问令牌（/api/open/token）。
 * 取消授权 → 带 error=access_denied 回跳，第三方可据此提示用户。
 */
export default function BindConsentPage() {
  const [params] = useSearchParams()
  const clientId = params.get('client_id') || ''
  const redirectUri = params.get('redirect_uri') || ''
  const state = params.get('state') || ''
  const scopeParam = params.get('scope') || ''

  // loading 校验中 / need-login 待登录 / ready 待确认 / redirecting 跳转中 / error 出错
  const [phase, setPhase] = useState('loading')
  const [app, setApp] = useState(null)
  const [user, setUser] = useState(null)
  const [scopes, setScopes] = useState([])   // 本次申请的权限范围（后端校验后回传）
  const [scope, setScope] = useState('profile')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState(() => localStorage.getItem('token') || '')

  useEffect(() => {
    if (!clientId || !redirectUri) {
      setPhase('error')
      setError(t('binding.consent.invalidParams'))
      return
    }
    let cancelled = false

    const run = async () => {
      setPhase('loading')
      setError('')
      // 1) 应用公开信息（无需登录，未在白名单/已停用直接 404）
      let info = null
      try {
        const res = await fetch(`/api/open/apps/${encodeURIComponent(clientId)}`)
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          if (cancelled) return
          setPhase('error')
          setError(res.status === 404 ? t('binding.consent.notWhitelisted') : (body?.detail || t('binding.consent.loadFailed')))
          return
        }
        info = body
      } catch {
        if (!cancelled) { setPhase('error'); setError(t('binding.consent.networkError')) }
        return
      }
      if (cancelled) return
      setApp(info)

      // 2) 未登录：先登录再回来确认（第三方入口可再点一次，或直接刷新本页）
      if (!token) {
        setPhase('need-login')
        return
      }

      // 3) 已登录：校验回调地址并回显当前账号
      try {
        const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri })
        if (state) query.set('state', state)
        if (scopeParam) query.set('scope', scopeParam)
        const res = await fetch(`/api/bind/authorize?${query.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const body = await res.json().catch(() => null)
        if (cancelled) return
        if (res.status === 401) {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          setToken('')
          setPhase('need-login')
          return
        }
        if (!res.ok) {
          setPhase('error')
          setError(body?.detail || t('binding.consent.loadFailed'))
          return
        }
        setUser(body.user)
        setScopes(Array.isArray(body.scopes) ? body.scopes : [])
        setScope(body.scope || 'profile')
        setPhase('ready')
      } catch {
        if (!cancelled) { setPhase('error'); setError(t('binding.consent.networkError')) }
      }
    }

    run()
    return () => { cancelled = true }
  }, [clientId, redirectUri, state, scopeParam, token])

  const decide = async (approve) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/bind/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ client_id: clientId, redirect_uri: redirectUri, state, scope, approve }),
      })
      const body = await res.json().catch(() => null)
      if (res.status === 401) {
        setBusy(false)
        setToken('')
        setPhase('need-login')
        return
      }
      if (!res.ok || !body?.redirect_url) {
        setBusy(false)
        setError((approve ? t('binding.consent.approveFailed') : t('binding.consent.denyFailed')) +
          (body?.detail ? `：${body.detail}` : ''))
        return
      }
      setPhase(approve ? 'redirecting' : 'denied')
      window.location.replace(body.redirect_url)
    } catch {
      setBusy(false)
      setError(t('binding.consent.networkError'))
    }
  }

  const redirectHost = (() => {
    try { return new URL(redirectUri).host } catch { return redirectUri }
  })()

  return (
    <div className="tool-page">
      <Navbar activePage="bind" />
      <div className="tool-main ab-main">
        <header className="tool-header">
          <Link to="/" className="tool-back">{t('binding.consent.back')}</Link>
          <h1 className="tool-title">{t('binding.consent.title')}</h1>
          <p className="tool-subtitle">{t('binding.consent.subtitle')}</p>
        </header>

        {phase === 'loading' && <div className="ab-loading">{t('binding.consent.loading')}</div>}

        {phase === 'error' && (
          <section className="ab-card">
            <h2 className="ab-app-name">{t('binding.consent.unavailable')}</h2>
            <p className="ab-error">{error}</p>
            <p className="ab-hint">{t('binding.consent.whitelistHint')}</p>
          </section>
        )}

        {phase === 'need-login' && (
          <section className="ab-card">
            {app && (
              <>
                <span className="ab-label">{t('binding.consent.applying')}</span>
                <h2 className="ab-app-name">{app.name}</h2>
                {app.description && <p className="ab-app-desc">{app.description}</p>}
              </>
            )}
            <p className="ab-hint">{t('binding.consent.needLogin')}</p>
            <p className="ab-hint">{t('binding.consent.reloginHint')}</p>
            <div className="ab-actions">
              <Link className="btn btn-primary" to="/auth">{t('binding.consent.goLogin')}</Link>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setToken(localStorage.getItem('token') || '')}
              >
                {t('binding.consent.loginDone')}
              </button>
            </div>
          </section>
        )}

        {(phase === 'ready' || phase === 'redirecting' || phase === 'denied') && app && (
          <section className="ab-card">
            <span className="ab-label">{t('binding.consent.applying')}</span>
            <h2 className="ab-app-name">{app.name}</h2>
            {app.description && <p className="ab-app-desc">{app.description}</p>}
            {app.homepage && (
              <p className="ab-app-home">
                <a href={app.homepage} target="_blank" rel="noopener noreferrer">{app.homepage}</a>
              </p>
            )}

            <hr className="ab-rule" />

            <div className="ab-block">
              <span className="ab-label">{t('binding.consent.scopeTitle')}</span>
              <ul className="ab-scope">
                {scopes.map(s => (
                  <li key={s.key}>
                    <UiIcon name="check" size={13} />
                    <span>
                      <strong>{s.key}</strong>
                      {s.description && <em>{s.description}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="ab-block">
              <span className="ab-label">{t('binding.consent.accountTitle')}</span>
              <p className="ab-account">{user?.nickname || user?.username}{user?.nickname ? ` (${user.username})` : ''}</p>
            </div>

            <div className="ab-block">
              <span className="ab-label">{t('binding.consent.redirectTitle')}</span>
              <p className="ab-account ab-mono">{redirectHost}</p>
            </div>

            {error && <p className="ab-error">{error}</p>}

            {phase === 'ready' ? (
              <div className="ab-actions">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(true)}>
                  {busy ? t('binding.consent.approving') : t('binding.consent.approve')}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => decide(false)}>
                  {t('binding.consent.deny')}
                </button>
              </div>
            ) : (
              <p className="ab-hint">
                {phase === 'denied' ? t('binding.consent.denied') : t('binding.consent.redirecting')}
              </p>
            )}

            <p className="ab-note">{t('binding.consent.securityNote')}</p>
          </section>
        )}
      </div>
    </div>
  )
}
