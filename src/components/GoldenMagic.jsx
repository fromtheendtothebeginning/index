// GoldenMagic.jsx — 黄金模式：激励模式且分数 > 0 时，有概率在左侧弹出询问；
// 确认后进入黄金主题（5 分钟），弹窗变为计时器（"是金子总会发光，__:__"）。
// 部署到服务器时把 GOLDEN_CHANCE 改为 0.05。

import { useEffect, useRef, useState } from 'react'
import { applyGolden } from '../utils/themeTransition'

const GOLDEN_CHANCE = 0.05 // 部署服务器 5%（本地开发可改 0.5）
const GOLDEN_UNTIL_KEY = 'lc_golden_until'
const DURATION = 5 * 60 * 1000 // 5 分钟
const SLOGANS = ['真是段美妙的旅程啊，马哈特。', '我也是这么想的，格鲁克大人', '万物成金魔法']

function GoldenMagic() {
  const [phase, setPhase] = useState(null) // 'ask' 询问 / 'active' 计时器
  const [remaining, setRemaining] = useState(0)
  const [slogan, setSlogan] = useState('')
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    setSlogan(SLOGANS[Math.floor(Math.random() * SLOGANS.length)])
  }, [])

  const applyGoldenExit = () => {
    if (exiting) return
    setExiting(true)
    // 退出动画：文字淡出 → 弹窗向左滑出屏幕外 → 恢复主题
    setTimeout(() => {
      applyGolden(false)
      localStorage.removeItem(GOLDEN_UNTIL_KEY)
      setPhase(null)
      setRemaining(0)
      setExiting(false)
    }, 900)
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

  return (
    <div className={`golden-magic ${phase === 'active' ? 'golden-magic-active' : ''} ${exiting ? 'golden-magic-exit' : ''}`}>
      {phase === 'ask' ? (
        <>
          <div className="golden-magic-title">{slogan}</div>
          <div className="golden-magic-text">
            你是激励分数超过 0 的玩家，是否将一切变成黄金？（5 分钟）
          </div>
          <div className="golden-magic-actions">
            <button className="btn btn-primary golden-magic-confirm" onClick={enterGolden}>
              进入黄金模式
            </button>
            <button className="golden-magic-cancel" onClick={() => setPhase(null)}>
              算了
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="golden-magic-title">{slogan}</div>
          <div className="golden-magic-timer">{mm}:{ss}</div>
          <div className="golden-magic-text">万物成金魔法生效中</div>
        </>
      )}
    </div>
  )
}

export default GoldenMagic
