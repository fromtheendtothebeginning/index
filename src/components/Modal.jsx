import { useEffect } from 'react'

/**
 * 统一弹窗组件 —— 复用 Blog.css 中的 .modal-overlay / .modal-sheet 样式
 * @param {object} props
 * @param {boolean} props.open - 是否显示
 * @param {string} props.title - 标题
 * @param {string} props.message - 描述
 * @param {string} [props.confirmText='确认'] - 确认按钮文案
 * @param {string} [props.cancelText='取消'] - 取消按钮文案
 * @param {boolean} [props.danger=false] - 是否危险操作（红色按钮）
 * @param {function} props.onConfirm - 确认回调
 * @param {function} props.onCancel - 取消回调
 */
function Modal({ open, title, message, confirmText = '确认', cancelText = '取消', danger = false, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && onCancel) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelText}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}

export default Modal
