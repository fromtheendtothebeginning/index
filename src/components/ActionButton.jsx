import { UiIcon } from './Icons'

/**
 * 统一操作按钮 —— 表单工具行/区块头等场景的通用小按钮，替代各处手写 btn 组合。
 * 颜色全部走 CSS 变量（--accent-* / --danger 等），新增主题自动适配；
 * 新增外观只需在 App.css 的 .action-btn 下扩展 variant 类。
 *
 * @param {string} [variant='default'] - 外观：default 描边 / accent 渐变主色 / danger 危险
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