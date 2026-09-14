import { UiIcon } from './Icons'

/**
 * 统一操作按钮 —— 表单工具行/区块头等场景的通用小按钮，替代各处手写 btn 组合。
 * 外观统一走 App.css 的 .action-btn 体系（单色，实心/描边，无圆角无阴影）。
 *
 * @param {string} [variant='default'] - 外观：default 实心墨块 / secondary 描边 / danger 危险（实描边加重）
 * @param {string} [size='default'] - 尺寸：default 常规 / sm 紧凑（区块头工具行）
 * @param {string} [icon] - 可选 UiIcon 图标名
 */
function ActionButton({ variant = 'default', size = 'default', icon, children, className = '', ...rest }) {
  const cls = [
    'action-btn',
    variant !== 'default' ? `action-btn-${variant}` : '',
    size !== 'default' ? `action-btn-${size}` : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <UiIcon name={icon} size={13} />}
      {children}
    </button>
  )
}

export default ActionButton