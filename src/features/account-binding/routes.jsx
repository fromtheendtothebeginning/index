import BindConsentPage from './BindConsentPage'

// 授权确认页（第三方项目把用户送到 /bind?client_id=..&redirect_uri=..&state=..）
// 用户侧的绑定管理在「我的 → 账号绑定」Tab，管理员白名单在「管理后台 → 绑定应用」Tab，
// 两处入口分别由 MyPage.jsx / AdminPage.jsx 引用本目录的面板组件，无需在此注册导航。
export default [
  { path: '/bind', element: <BindConsentPage /> },
]
