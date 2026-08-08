import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 主题应用：localStorage.theme（system/light/dark，默认跟随系统）
// system 不设置 data-theme（CSS 媒体查询自动跟随）；light/dark 显式覆盖
const applyTheme = () => {
  const theme = localStorage.getItem('theme') || 'system'
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}
applyTheme()
window.addEventListener('storage', (e) => {
  if (e.key === 'theme') applyTheme()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
