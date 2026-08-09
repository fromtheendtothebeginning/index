/**
 * 统一分类/选项下拉选择器（悬停展开 + 动画，复用 App.css 的 .nav-dropdown / .category-btn 体系）。
 * 所有分类/选项选择场景统一使用本组件，避免各处手写重复结构。
 *
 * @param {string} value - 当前选中值（显示在按钮上）
 * @param {function(string)} onChange - 选择回调（参数为选项 value，清空时传 ''）
 * @param {Array<{value: string, label: string}>} options - 选项列表
 * @param {string} [placeholder='未分类'] - 未选中时按钮显示文案（也是菜单第一项「清除」的文案）
 * @param {'default'|'sm'} [size='default'] - 尺寸：default 常规 / sm 小号（卡片等紧凑场景）
 * @param {boolean} [hideClear=false] - 为 true 时不显示菜单第一项「清除」入口（如必须选其一且不可清空的场景）
 *
 * 用法示例：
 *   <CategoryDropdown
 *     value={category}
 *     onChange={setCategory}
 *     options={[{ value: '技术讨论', label: '技术讨论' }, { value: '更新日志', label: '更新日志' }]}
 *     placeholder="无"
 *   />
 */
function CategoryDropdown({ value, onChange, options = [], placeholder = '未分类', size = 'default', hideClear = false }) {
  const pick = (v) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(v)
  }
  return (
    <div className="nav-dropdown" onClick={e => e.stopPropagation()}>
      <button type="button" className={`category-btn${size === 'sm' ? ' category-btn-sm' : ''}`}>
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
