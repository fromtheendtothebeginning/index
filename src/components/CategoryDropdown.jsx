import { useState } from 'react'

/**
 * 统一分类/选项下拉选择器（悬停展开 + 动画，复用 App.css 的 .nav-dropdown / .category-btn 体系）。
 * 所有分类/选项选择场景统一使用本组件，避免各处手写重复结构。
 * 移动端（≤768px）改为点击展开，选项列表静态流入文档流（.mobile-open 控制显隐）。
 *
 * @param {string} value - 当前选中值（显示在按钮上）
 * @param {function(string)} onChange - 选择回调（参数为选项 value，清空时传 ''）
 * @param {Array<{value: string, label: string}>} options - 选项列表
 * @param {string} [placeholder='未分类'] - 未选中时按钮显示文案（也是菜单第一项「清除」的文案）
 * @param {'default'|'sm'} [size='default'] - 尺寸：default 常规 / sm 小号（卡片等紧凑场景）
 * @param {boolean} [hideClear=false] - 为 true 时不显示菜单第一项「清除」入口（如必须选其一且不可清空的场景）
 * @param {boolean} [closeOnSelect=false] - 为 true 时选中后立即收起菜单（鼠标离开后恢复 hover）
 *
 * 用法示例：
 *   <CategoryDropdown
 *     value={category}
 *     onChange={setCategory}
 *     options={[{ value: '技术讨论', label: '技术讨论' }, { value: '更新日志', label: '更新日志' }]}
 *     placeholder="无"
 *   />
 */
function CategoryDropdown({ value, onChange, options = [], placeholder = '未分类', size = 'default', hideClear = false, closeOnSelect = false }) {
  // 移动端选项列表开合
  const [open, setOpen] = useState(false)
  // 选中后收起：桌面端 hover 菜单在选中后临时隐藏，鼠标离开后恢复可 hover
  const [justPicked, setJustPicked] = useState(false)

  const pick = (v) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(v)
    setOpen(false)
    if (closeOnSelect) setJustPicked(true)
  }

  const toggle = () => {
    if (window.innerWidth < 768) setOpen(o => !o)
  }

  return (
    <div
      className={`nav-dropdown ${open ? 'mobile-open' : ''} ${justPicked ? 'just-picked' : ''}`}
      onClick={e => e.stopPropagation()}
      onMouseLeave={() => setJustPicked(false)}
    >
      <button type="button" className={`category-btn${size === 'sm' ? ' category-btn-sm' : ''}`} onClick={toggle}>
        {options.find(o => o.value === value)?.label || value || placeholder}
        <span className="arrow-down">▾</span>
      </button>
      <div className="nav-dropdown-menu">
        {!hideClear && <a href="#" onClick={pick('')}>{placeholder}</a>}
        {options.map(opt => (
          <a key={opt.value} href="#" onClick={pick(opt.value)}>{opt.label}</a>
        ))}
      </div>
    </div>
  )
}

export default CategoryDropdown
