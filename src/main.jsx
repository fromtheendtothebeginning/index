import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { THEMES, THEME_KEYS, detectThemeMode, modeIsDark } from './utils/themes'
import './index.css'

// 初始主题应用：将所选主题变量直接写入 :root（无动画，首帧即正确主题），
// 之后切换走 themeTransition.applyTheme 自动渐变。
const applyTheme = () => {
  const root = document.documentElement
  const mode = detectThemeMode()
  if (mode === 'system') {
    root.removeAttribute('data-theme')
    const name = modeIsDark('system') ? 'dark' : 'light'
    for (const key of THEME_KEYS) root.style.setProperty(key, THEMES[name][key])
  } else {
    root.setAttribute('data-theme', mode)
    for (const key of THEME_KEYS) root.style.setProperty(key, THEMES[mode][key])
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
