import { Link } from 'react-router-dom'

/**
 * 统一导航栏目组件：所有栏目共用同一结构与样式，新增栏目时直接复用。
 * 有 children 时渲染下拉菜单（children 为若干 <Link>），无 children 时为普通链接栏目。
 *
 * @param {string} label - 栏目名
 * @param {string} to - 点击跳转路径
 * @param {boolean} [active=false] - 是否高亮（与当前页面匹配）
 * @param {ReactNode} [children] - 下拉菜单内容
 */
function NavItem({ label, to, active = false, children }) {
  return (
    <div className="nav-dropdown">
      <Link to={to} className={`nav-dropdown-trigger ${active ? 'nav-item-active' : ''}`}>
        {label}
        {children && <span className="arrow-down">▾</span>}
      </Link>
      {children && <div className="nav-dropdown-menu">{children}</div>}
    </div>
  )
}

export default NavItem
