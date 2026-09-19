import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Modal from '../../components/Modal'
import CategoryDropdown from '../../components/CategoryDropdown'
import PdfPreview from '../img2latex/PdfPreview'
import { t } from '../../i18n'
import { authHeaders } from '../../utils/api'
import '../../pages/ToolParsePage.css'
import './PrintPage.css'

const TOKEN_KEY = 'print_token'
const USER_KEY = 'print_user'
const ANTIPRINT_URL = 'https://print.anticraft.top'

// AntiPrint 任务状态 → 徽标样式（状态文案本身是打印服务返回的中文，直接展示）
const STATUS_CLS = {
  '待审核': 'ps-badge-wait',
  '已通过': 'ps-badge-ok',
  '打印中': 'ps-badge-busy',
  '已打印': 'ps-badge-ok',
  '待配送': 'ps-badge-ok',
  '待取件': 'ps-badge-ok',
  '已完成': 'ps-badge-done',
  '已驳回': 'ps-badge-danger',
  '打印失败': 'ps-badge-danger',
}

const NUPS = ['1,1', '2,1', '1,2', '2,2', '3,3', '4,4']

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB'
  return Math.max(1, Math.round(bytes / 1024)) + 'KB'
}

function detailText(detail) {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  if (typeof detail === 'object') return String(detail.message || JSON.stringify(detail))
  return String(detail)
}

export default function PrintPage() {
  const token = localStorage.getItem('token')
  const [printToken, setPrintToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [printUser, setPrintUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
  })

  const [balance, setBalance] = useState(null)
  const [profile, setProfile] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [errMsg, setErrMsg] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [withdrawTarget, setWithdrawTarget] = useState(null) // { id, name }
  const [fileOp, setFileOp] = useState(null) // 正在取回的任务文件 { jobId, fileId, download }
  const [preview, setPreview] = useState(null) // 任务卡内嵌预览 { key, url, kind, name }
  const [localPreviewKey, setLocalPreviewKey] = useState('') // 本次提交文件里正在预览的那个

  // 绑定表单（用 anticraft 账号密码换打印令牌，密码不落库）
  const [username, setUsername] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').username || '' } catch { return '' }
  })
  const [password, setPassword] = useState('')
  const [formMsg, setFormMsg] = useState('')
  const [binding, setBinding] = useState(false)

  // 提交表单
  const [fileList, setFileList] = useState([])
  const [deliveryMode, setDeliveryMode] = useState('配送')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [copies, setCopies] = useState('1')
  const [pages, setPages] = useState('')
  const [nup, setNup] = useState('')

  const printHeaders = useCallback(
    () => ({ ...authHeaders(), 'X-Print-Token': printToken }),
    [printToken]
  )

  const resetBind = useCallback((msg) => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setPrintToken('')
    setPrintUser(null)
    setBalance(null)
    setJobs(null)
    setErrMsg('')
    setNotice('')
    if (msg) setFormMsg(msg)
  }, [])

  const loadData = useCallback(async () => {
    if (!token || !printToken) return
    try {
      const [bRes, jRes, pRes] = await Promise.all([
        fetch('/api/print/balance', { headers: printHeaders() }),
        fetch('/api/print/jobs', { headers: printHeaders() }),
        fetch('/api/print/profile', { headers: printHeaders() }),
      ])
      if (bRes.status === 401 || jRes.status === 401) {
        resetBind(t('printService.expired'))
        return
      }
      const b = await bRes.json().catch(() => null)
      const j = await jRes.json().catch(() => null)
      const p = await pRes.json().catch(() => null)
      if (bRes.ok) setBalance(b)
      if (jRes.ok) setJobs(j.jobs || [])
      else setErrMsg(detailText(j && j.detail))
      if (pRes.ok) setProfile(p)
    } catch {
      setErrMsg(t('printService.netError'))
    }
  }, [token, printToken, printHeaders, resetBind])

  useEffect(() => {
    if (printToken) loadData()
  }, [printToken, loadData])

  // AntiPrint 里的默认地址/配送方式只用来预填空表单
  useEffect(() => {
    if (!profile) return
    setAddress((prev) => prev || profile.default_address || '')
    setDeliveryMode((prev) => prev || profile.default_delivery || '配送')
  }, [profile])

  const handleBind = async () => {
    if (!username.trim() || !password) {
      setFormMsg(t('printService.needUserPwd'))
      return
    }
    setBinding(true)
    setFormMsg('')
    try {
      const res = await fetch('/api/print/login', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const b = await res.json().catch(() => null)
      if (!res.ok) {
        setFormMsg(detailText(b && b.detail) || t('printService.bindFail'))
        return
      }
      localStorage.setItem(TOKEN_KEY, b.token)
      localStorage.setItem(USER_KEY, JSON.stringify(b.user || { username: username.trim() }))
      setPrintToken(b.token)
      setPrintUser(b.user || { username: username.trim() })
      setPassword('')
    } catch {
      setFormMsg(t('printService.netError'))
    } finally {
      setBinding(false)
    }
  }

  const previewable = (file) => /^image\//.test(file.type) || file.type === 'application/pdf'

  const handlePickFiles = (e) => {
    const picked = Array.from(e.target.files || [])
    if (!picked.length) return
    const added = picked
      .slice(0, 5 - fileList.length)
      .map((file) => ({
        file,
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: previewable(file) ? URL.createObjectURL(file) : null,
      }))
    setFileList([...fileList, ...added])
    if (!localPreviewKey) {
      const first = added.find((it) => it.url) || added[0]
      if (first) setLocalPreviewKey(first.key)
    }
    e.target.value = ''
  }

  const removeFile = (key) => {
    const it = fileList.find((x) => x.key === key)
    if (it && it.url) URL.revokeObjectURL(it.url)
    if (localPreviewKey === key) setLocalPreviewKey('')
    setFileList(fileList.filter((x) => x.key !== key))
  }

  // 卸载时回收本地预览用的 object URL
  const fileListRef = useRef(fileList)
  fileListRef.current = fileList
  useEffect(() => () => {
    fileListRef.current.forEach((it) => { if (it.url) URL.revokeObjectURL(it.url) })
  }, [])

  const handleSubmit = async () => {
    if (!fileList.length) {
      setErrMsg(t('printService.noFile'))
      return
    }
    if (deliveryMode === '配送' && !address.trim()) {
      setErrMsg(t('printService.addressRequired'))
      return
    }
    setBusy(true)
    setErrMsg('')
    setNotice('')
    try {
      const fd = new FormData()
      fileList.forEach((it) => fd.append('files', it.file))
      fd.append('delivery_mode', deliveryMode)
      fd.append('copies', String(parseInt(copies, 10) || 1))
      if (deliveryMode === '配送') fd.append('address', address.trim())
      if (note.trim()) fd.append('note', note.trim())
      const opts = { paper: 'A4' }   // 打印机只能出 A4，固定带上
      if (pages.trim()) opts.pages = pages.trim()
      if (nup) opts.nup = nup
      fd.append('settings', JSON.stringify(fileList.map(() => ({ ...opts }))))
      const res = await fetch('/api/print/jobs', { method: 'POST', headers: printHeaders(), body: fd })
      const b = await res.json().catch(() => null)
      if (res.status === 401) { resetBind(t('printService.expired')); return }
      if (!res.ok) {
        setErrMsg(detailText(b && b.detail) || t('printService.netError'))
        return
      }
      setNotice(t('printService.submitOk', {
        id: b.job && b.job.id,
        charge: b.charge,
        balance: b.balance,
      }))
      setFileList([])
      loadData()
    } catch {
      setErrMsg(t('printService.netError'))
    } finally {
      setBusy(false)
    }
  }

  const handleWithdraw = async () => {
    if (!withdrawTarget) return
    setBusy(true)
    try {
      const res = await fetch(`/api/print/jobs/${withdrawTarget.id}/withdraw`, {
        method: 'POST', headers: printHeaders(),
      })
      const b = await res.json().catch(() => null)
      if (res.status === 401) { resetBind(t('printService.expired')); return }
      setWithdrawTarget(null)
      if (!res.ok) {
        setErrMsg(detailText(b && b.detail) || t('printService.netError'))
        return
      }
      setNotice(t('printService.withdrawn', { refunded: b.refunded || '0' }))
      loadData()
    } catch {
      setErrMsg(t('printService.netError'))
    } finally {
      setBusy(false)
    }
  }

  const canWithdraw = (j) => j.status === '待审核' || j.status === '已通过'

  // 任务卡内嵌预览：fetch 带双重鉴权头取回 blob，直接在卡里渲染（PDF iframe / 图片直显）
  const previewRef = useRef(null)
  previewRef.current = preview
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current.url) }, [])

  const closePreview = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url)
    previewRef.current = null
    setPreview(null)
  }

  const togglePreview = async (job, f) => {
    const key = `${job.id}:${f.id}`
    if (preview && preview.key === key) { closePreview(); return }
    setFileOp({ jobId: job.id, fileId: f.id, download: false })
    closePreview()
    try {
      const res = await fetch(`/api/print/jobs/${job.id}/files/${f.id}`, { headers: printHeaders() })
      if (res.status === 401) { resetBind(t('printService.expired')); return }
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setErrMsg(detailText(b && b.detail) || t('printService.netError'))
        return
      }
      const blob = await res.blob()
      const kind = /^image\//.test(blob.type) ? 'image' : 'pdf'
      const url = URL.createObjectURL(blob)
      previewRef.current = { key, url }
      setPreview({ key, url, kind, name: f.filename })
    } catch {
      setErrMsg(t('printService.netError'))
    } finally {
      setFileOp(null)
    }
  }

  // 下载原件：取 blob 后用隐藏 <a> 触发保存
  const downloadJobFile = async (jobId, fileId, filename) => {
    setFileOp({ jobId, fileId, download: true })
    try {
      const res = await fetch(`/api/print/jobs/${jobId}/files/${fileId}?download=1`, { headers: printHeaders() })
      if (res.status === 401) { resetBind(t('printService.expired')); return }
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setErrMsg(detailText(b && b.detail) || t('printService.netError'))
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'file'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      setErrMsg(t('printService.netError'))
    } finally {
      setFileOp(null)
    }
  }

  if (!token) {
    return (
      <div className="tool-page">
        <Navbar activePage="tools" />
        <div className="tool-main">
          <header className="tool-header">
            <Link to="/tools" className="tool-back">{t('printService.back')}</Link>
            <h1 className="tool-title">{t('printService.title')}</h1>
          </header>
          <div className="tool-login-hint">{t('printService.loginRequired')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main">
        <header className="tool-header">
          <Link to="/tools" className="tool-back">{t('printService.back')}</Link>
          <h1 className="tool-title">{t('printService.title')}</h1>
          <p className="tool-subtitle">{t('printService.subtitle')}</p>
        </header>

        {!printToken ? (
          <div className="ps-panel">
            <h2 className="ps-panel-title">{t('printService.bindTitle')}</h2>
            <p className="ps-bind-desc">{t('printService.bindDesc')}</p>
            <p className="ps-bind-hint">
              {t('printService.hasAccount')}
              <a href={ANTIPRINT_URL} target="_blank" rel="noreferrer" className="ps-bind-link">
                {t('printService.openAntiprint')} <span className="ps-ext">↗</span>
              </a>
            </p>
            <div className="ps-form">
              <input className="tool-input ps-input" placeholder={t('printService.username')}
                     value={username} onChange={e => setUsername(e.target.value)} />
              <input className="tool-input ps-input" type="password" placeholder={t('printService.password')}
                     value={password} onChange={e => setPassword(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') handleBind() }} />
              <button className="btn btn-primary" onClick={handleBind} disabled={binding || !username.trim() || !password}>
                {binding ? t('printService.binding') : t('printService.bind')}
              </button>
            </div>
            {formMsg && <p className="ps-form-msg">{formMsg}</p>}
          </div>
        ) : (
          <>
            <div className="ps-panel ps-account">
              <div className="ps-account-main">
                <span className="ps-account-label">{t('printService.loggedAs')}</span>
                <span className="ps-account-name">{(printUser && printUser.username) || '-'}</span>
              </div>
              <div className="ps-account-balance">
                {balance && (
                  <>
                    <span className="ps-balance-num">{balance.balance}</span>
                    <span className="ps-balance-unit">{t('printService.yuan')}</span>
                    {!balance.billable && balance.free_reason && (
                      <span className="ps-free">{balance.free_reason}</span>
                    )}
                    {balance.billable && balance.price && (
                      <span className="ps-price">{t('printService.pricePerSheet', { price: balance.price })}</span>
                    )}
                  </>
                )}
              </div>
              <button type="button" className="btn btn-secondary ps-op-btn" onClick={() => resetBind()}>
                {t('printService.rebind')}
              </button>
              <a className="btn btn-secondary ps-op-btn ps-ext-link" href={ANTIPRINT_URL} target="_blank" rel="noreferrer">
                {t('printService.openAntiprint')} <span className="ps-ext">↗</span>
              </a>
            </div>

            {notice && <div className="ps-ok">{notice}</div>}
            {errMsg && <div className="tool-error">{errMsg}</div>}

            <div className="ps-panel">
              <h2 className="ps-panel-title">{t('printService.submitTitle')}</h2>
              <div className="ps-form">
                <div className="ps-row">
                  <span className="ps-row-label">{t('printService.deliveryMode')}</span>
                  <div className="ps-seg">
                    <button type="button" className={`ps-seg-item${deliveryMode === '配送' ? ' on' : ''}`}
                            onClick={() => setDeliveryMode('配送')}>{t('printService.delivery')}</button>
                    <button type="button" className={`ps-seg-item${deliveryMode === '取件' ? ' on' : ''}`}
                            onClick={() => setDeliveryMode('取件')}>{t('printService.pickup')}</button>
                  </div>
                </div>
                {deliveryMode === '配送' && (
                  <input className="tool-input ps-input" placeholder={t('printService.address')}
                         value={address} onChange={e => setAddress(e.target.value)} maxLength={255} />
                )}
                <input className="tool-input ps-input" placeholder={t('printService.notePh')}
                       value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
                <div className="ps-row">
                  <span className="ps-row-label">{t('printService.copies')}</span>
                  <input className="tool-input ps-input ps-input-num" type="number" min="1" max="99"
                         value={copies} onChange={e => setCopies(e.target.value)} />
                </div>
                <details className="ps-adv">
                  <summary>{t('printService.advSettings')}</summary>
                  <div className="ps-adv-grid">
                    <label className="ps-adv-field">
                      <span>{t('printService.pages')}</span>
                      <input className="tool-input ps-input" placeholder={t('printService.pagesPh')}
                             value={pages} onChange={e => setPages(e.target.value)} />
                    </label>
                    <div className="ps-adv-field">
                      <span>{t('printService.nup')}</span>
                      <CategoryDropdown size="sm" value={nup} onChange={setNup}
                                        options={NUPS.map((n) => ({ value: n, label: n }))}
                                        placeholder={t('printService.default')} />
                    </div>
                  </div>
                </details>
                <div className="ps-files">
                  <label className="btn btn-secondary ps-file-btn">
                    {t('printService.chooseFiles')}
                    <input type="file" multiple accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg,.doc,.docx,.ppt,.pptx" hidden onChange={handlePickFiles}
                           disabled={fileList.length >= 5} />
                  </label>
                  <span className="ps-files-hint">{t('printService.filesHint')}</span>
                </div>
                {fileList.length > 0 && (
                  <ul className="ps-file-list">
                    {fileList.map((it) => (
                      <li key={it.key} className={`ps-file-item${localPreviewKey === it.key ? ' on' : ''}`}>
                        {it.url && /^image\//.test(it.file.type) ? (
                          <img className="ps-file-thumb" src={it.url} alt="" />
                        ) : (
                          <span className="ps-file-thumb ps-file-thumb-blank">{(it.file.name.split('.').pop() || '?').slice(0, 4)}</span>
                        )}
                        <span className={`ps-file-name clickable${localPreviewKey === it.key ? ' on' : ''}`}
                              onClick={() => setLocalPreviewKey(it.key)}
                              title={t('printService.preview')}>
                          {it.file.name}
                        </span>
                        <span className="ps-file-size">{fmtSize(it.file.size)}</span>
                        <button type="button" className="ps-file-del" onClick={() => removeFile(it.key)}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
                {fileList.length > 0 && (() => {
                  const it = fileList.find((x) => x.key === localPreviewKey)
                  return (
                    <div className="ps-preview-block">
                      <div className="ps-preview-picker">
                        <CategoryDropdown value={localPreviewKey} onChange={setLocalPreviewKey}
                                          options={fileList.map((x) => ({ value: x.key, label: x.file.name }))}
                                          placeholder={t('printService.pickFile')} hideClear />
                      </div>
                      {!it ? (
                        <p className="ps-empty">{t('printService.pickHint')}</p>
                      ) : !it.url ? (
                        <p className="ps-empty">{t('printService.noPreview')}</p>
                      ) : /^image\//.test(it.file.type) ? (
                        <div className="ps-viewer"><img className="ps-viewer-img" src={it.url} alt={it.file.name} /></div>
                      ) : (
                        <div className="ps-viewer"><PdfPreview url={it.url} /></div>
                      )}
                    </div>
                  )
                })()}
                <button className="btn btn-primary ps-submit" onClick={handleSubmit} disabled={busy}>
                  {busy ? t('printService.submitting') : t('printService.submit')}
                </button>
                {!busy && deliveryMode === '配送' && !address.trim() && (
                  <p className="ps-empty">{t('printService.addressRequired')}</p>
                )}
              </div>
            </div>

            <div className="ps-panel">
              <h2 className="ps-panel-title">{t('printService.jobsTitle')}</h2>
              {jobs === null ? (
                <p className="ps-empty">{t('printService.loading')}</p>
              ) : jobs.length === 0 ? (
                <p className="ps-empty">{t('printService.noJobs')}</p>
              ) : (
                <ul className="ps-jobs">
                  {jobs.map(j => (
                    <li key={j.id} className="ps-job">
                      <button type="button" className="ps-job-head" onClick={() => setExpanded(expanded === j.id ? null : j.id)}>
                        <span className="ps-job-id">#{j.id}</span>
                        <span className={`ps-badge ${STATUS_CLS[j.status] || 'ps-badge-wait'}`}>{j.status}</span>
                        <span className="ps-job-name">
                          {(j.files || []).map(f => f.filename).join('、') || '-'}
                        </span>
                        <span className="ps-job-meta">
                          {j.delivery_mode} · ×{j.copies}
                        </span>
                      </button>
                      {expanded === j.id && (
                        <div className="ps-job-body">
                          {(j.files || []).length > 0 && (
                            <div className="ps-job-files">
                              <span className="ps-job-files-label">{t('printService.filesLabel')}</span>
                              {(j.files || []).map((f) => {
                                const key = `${j.id}:${f.id}`
                                const previewing = preview && preview.key === key
                                return (
                                  <div key={f.id} className="ps-file-block">
                                    <div className="ps-job-file">
                                      <span className="ps-job-file-name">{f.filename}</span>
                                      <button type="button" className="btn btn-secondary ps-op-btn" disabled={!!fileOp}
                                              onClick={() => togglePreview(j, f)}>
                                        {fileOp && fileOp.fileId === f.id && !fileOp.download
                                          ? <span className="ps-spinner" />
                                          : (previewing ? t('printService.hidePreview') : t('printService.preview'))}
                                      </button>
                                      <button type="button" className="btn btn-secondary ps-op-btn" disabled={!!fileOp}
                                              onClick={() => downloadJobFile(j.id, f.id, f.filename)}>
                                        {fileOp && fileOp.fileId === f.id && fileOp.download
                                          ? <span className="ps-spinner" />
                                          : t('printService.download')}
                                      </button>
                                    </div>
                                    {previewing && (
                                      <div className="ps-viewer">
                                        <div className="ps-viewer-bar">
                                          <span className="ps-viewer-name">{preview.name}</span>
                                          <button type="button" className="ps-file-del" onClick={closePreview}>✕</button>
                                        </div>
                                        {preview.kind === 'image'
                                          ? <img className="ps-viewer-img" src={preview.url} alt={preview.name} />
                                          : <PdfPreview url={preview.url} />}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {j.address && <p className="ps-job-line"><b>{t('printService.address')}：</b>{j.address}</p>}
                          {j.note && <p className="ps-job-line"><b>{t('printService.note')}：</b>{j.note}</p>}
                          {j.charge != null && <p className="ps-job-line"><b>{t('printService.charge')}：</b>{j.charge} {t('printService.yuan')}</p>}
                          {j.reject_reason && <p className="ps-job-line ps-job-warn"><b>{t('printService.rejectReason')}：</b>{j.reject_reason}</p>}
                          {j.print_error && <p className="ps-job-line ps-job-warn"><b>{t('printService.printError')}：</b>{j.print_error}</p>}
                          {canWithdraw(j) && (
                            <button type="button" className="btn btn-secondary ps-op-btn ps-op-danger"
                                    onClick={() => setWithdrawTarget({ id: j.id, name: (j.files || []).map(f => f.filename).join('、') })}>
                              {t('printService.withdraw')}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        open={!!withdrawTarget}
        title={t('printService.withdrawTitle')}
        confirmText={t('printService.withdraw')}
        cancelText={t('modal.cancel')}
        confirmDisabled={busy}
        onConfirm={handleWithdraw}
        onCancel={() => setWithdrawTarget(null)}
      >
        <p className="ps-del-text">
          {t('printService.withdrawText', { id: withdrawTarget ? withdrawTarget.id : '' })}
        </p>
      </Modal>
    </div>
  )
}
