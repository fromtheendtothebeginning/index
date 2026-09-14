// GoldenMagic.jsx — 黄金模式：激励模式且分数 > 0 时，有概率在左侧弹出询问；
// 确认后进入黄金主题（5 分钟），弹窗变为计时器（"是金子总会发光，__:__"）。
// 面板动画参照《我的世界》成就弹窗：自屏幕边缘横向滑入（快进缓出）、原路滑出、不淡入淡出。
// 部署到服务器时把 GOLDEN_CHANCE 改为 0.05。

import { useEffect, useRef, useState } from 'react'
import { applyGolden } from '../utils/themeTransition'
import { UiIcon } from './Icons'
import { t } from '../i18n'

const GOLDEN_CHANCE = 0.05 // 部署服务器 5%（本地开发可改 0.5）
const GOLDEN_UNTIL_KEY = 'lc_golden_until'
const GOLDEN_COLLAPSED_KEY = 'lc_golden_collapsed'
const DURATION = 5 * 60 * 1000 // 5 分钟
const SLOGANS = ['golden.slogan1', 'golden.slogan2', 'golden.slogan3']

function GoldenMagic() {
  const [phase, setPhase] = useState(null) // 'ask' 询问 / 'active' 计时器
  const [remaining, setRemaining] = useState(0)
  const [slogan, setSlogan] = useState('')
  const [exiting, setExiting] = useState(false)
  // 收起态：只留倒计时（询问态收起则只留模式名）；计时期间跨刷新保持
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(GOLDEN_COLLAPSED_KEY) === '1')
  const timerRef = useRef(null)

  useEffect(() => {
    setSlogan(SLOGANS[Math.floor(Math.random() * SLOGANS.length)])
  }, [])

  const toggleCollapsed = (next) => {
    setCollapsed(next)
    if (next) localStorage.setItem(GOLDEN_COLLAPSED_KEY, '1')
    else localStorage.removeItem(GOLDEN_COLLAPSED_KEY)
  }

  const applyGoldenExit = () => {
    if (exiting) return
    setExiting(true)
    // 退出动画：横向滑出屏幕（与入场同侧，MC 成就弹窗的原路退出），结束后恢复主题
    setTimeout(() => {
      applyGolden(false)
      localStorage.removeItem(GOLDEN_UNTIL_KEY)
      localStorage.removeItem(GOLDEN_COLLAPSED_KEY)
      setPhase(null)
      setRemaining(0)
      setExiting(false)
      setCollapsed(false)
    }, 420)
  }

  useEffect(() => {
    // 刷新恢复：仍在 5 分钟黄金期内 → 恢复主题 + 计时器
    const until = Number(localStorage.getItem(GOLDEN_UNTIL_KEY) || 0)
    if (Date.now() < until) {
      applyGolden(true)
      setPhase('active')
      setRemaining(until - Date.now())
      return
    }

    const eligible = (() => {
      try {
        const c = JSON.parse(localStorage.getItem('lc_me_cache') || 'null')
        return !!(c && c.bound && c.boost_mode && c.score > 0)
      } catch { return false }
    })()
    if (!eligible) return
    if (Math.random() < GOLDEN_CHANCE) {
      setPhase('ask')
    }
  }, [])

  // 计时器驱动
  useEffect(() => {
    if (phase !== 'active') return
    const tick = () => {
      const until = Number(localStorage.getItem(GOLDEN_UNTIL_KEY) || 0)
      const left = until - Date.now()
      if (left <= 0) {
        applyGoldenExit()
        return
      }
      setRemaining(left)
    }
    tick()
    timerRef.current = setInterval(tick, 500)
    return () => clearInterval(timerRef.current)
  }, [phase])

  const enterGolden = () => {
    const until = Date.now() + DURATION
    localStorage.setItem(GOLDEN_UNTIL_KEY, String(until))
    applyGolden(true)
    setPhase('active')
    setRemaining(DURATION)
  }

  if (!phase) return null

  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')

  const collapseBtn = (
    <button
      type="button"
      className="golden-magic-collapse"
      onClick={() => toggleCollapsed(true)}
      title={t('golden.collapse')}
      aria-label={t('golden.collapse')}
    >
      <UiIcon name="chevron-left" size={16} />
    </button>
  )

  return (
    <div
      className={`golden-magic ${phase === 'active' ? 'golden-magic-active' : ''} ${exiting ? 'golden-magic-exit' : ''} ${collapsed ? 'golden-magic-collapsed' : ''}`}
    >
      <div className="golden-magic-body">
        <div className="golden-magic-head">
          <span className="golden-magic-title">{t(slogan)}</span>
          {collapseBtn}
        </div>
        {phase === 'ask' ? (
          <>
            <p className="golden-magic-text">{t('golden.prompt')}</p>
            <div className="golden-magic-actions">
              <button className="btn btn-primary golden-magic-confirm" onClick={enterGolden}>
                {t('golden.enter')}
              </button>
              <button className="golden-magic-cancel" onClick={() => setPhase(null)}>
                {t('golden.cancel')}
              </button>
            </div>
          </>
        ) : (
          <div className="golden-magic-row">
            <span className="golden-magic-timer">{mm}:{ss}</span>
            <span className="golden-magic-text">{t('golden.effect')}</span>
          </div>
        )}
      </div>
      {/* 收起态：整块即按钮。计时中只显示倒计时，询问态只显示模式名 */}
      <button
        type="button"
        className="golden-magic-restore"
        onClick={() => toggleCollapsed(false)}
        title={t('golden.expand')}
        aria-label={t('golden.expand')}
      >
        {phase === 'active'
          ? <span className="golden-magic-timer">{mm}:{ss}</span>
          : <span className="golden-magic-chip">{t('golden.short')}</span>}
      </button>
    </div>
  )
}

export default GoldenMagic
