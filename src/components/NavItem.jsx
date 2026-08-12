import { useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * 统一导航栏目组件：所有栏目共用同一结构与样式，新增栏目时直接复用。
 * 有 children 时渲染下拉菜单（children 为若干 <Link>），无 children 时为普通链接栏目。
 *
 * @param {string} label - 栏目名
 * @param {string} to - 点击跳转路径
 * @param {boolean} [active=false] - 是否高亮（与当前页面匹配）
 * @param {ReactNode} [children] - 下拉菜单内容
 * @param {function} [onNavigate] - 链接点击后的回调（移动端抽屉用于关闭菜单）
 */
function NavItem({ label, to, active = false, children, onNavigate }) {
  // 移动端子菜单开合（≤768px 点击 trigger 展开；桌面端仍为纯 hover，点击照常跳转）
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleTriggerClick = (e) => {
    if (window.innerWidth < 768 && children) {
      e.preventDefault() // 移动端点击只展开/收起子菜单，不跳转
      setMobileOpen(o => !o)
    } else if (onNavigate) {
      onNavigate()
    }
  }

  // 子菜单内任意链接点击后触发（关闭移动端抽屉）
  const handleMenuClick = () => {
    if (onNavigate) onNavigate()
  }

  return (
    <div className={`nav-dropdown ${children && mobileOpen ? 'mobile-open' : ''}`}>
      <Link to={to} className={`nav-dropdown-trigger ${active ? 'nav-item-active' : ''}`} onClick={handleTriggerClick}>
        {label}
        {children && <span className="arrow-down">▾</span>}
      </Link>
      {children && <div className="nav-dropdown-menu" onClick={handleMenuClick}>{children}</div>}
    </div>
  )
}

export default NavItem
