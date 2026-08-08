import { useEffect, useRef, useState } from 'react'

/**
 * 统一入场动画组件：复用 App.css 全局的 .scroll-reveal / .revealed 样式。
 * 自身通过 IntersectionObserver 观察，进入视口后添加 revealed 类（opacity 0 → 1 + 上移归位）。
 * 自观察特性天然兼容异步渲染的元素（如列表加载后出现的卡片）。
 * 通过 as 可渲染为任意标签（div/Link/h1 等，自动转发 ref）。
 *
 * 用法：
 *   <Reveal>...</Reveal>
 *   <Reveal as={Link} to="/x" className="project-card">...</Reveal>
 *   <Reveal as="h1" className="editor-title">标题</Reveal>
 */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setRevealed(true)
            obs.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const cls = `scroll-reveal${revealed ? ' revealed' : ''}${className ? ' ' + className : ''}`
  return (
    <Tag ref={ref} className={cls} {...rest}>
      {children}
    </Tag>
  )
}

export default Reveal
