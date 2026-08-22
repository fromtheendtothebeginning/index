# features/ — 功能模块目录

约定：**每个新功能一个文件夹**，`src/features/<kebab-name>/`（小写中划线命名）。新增页面/功能只写新文件，`App.jsx`、`Navbar.jsx` 等旧文件零改动即自动生效。

## 文件夹结构

```
src/features/
  <kebab-name>/
    routes.js(x)   # 必需，路由注册表
    XxxPage.jsx    # 页面组件
    Xxx.css        # 样式（页面自行 import）
    ...            # 该功能的子组件等
```

## routes.js(x) 约定

必需的默认导出为路由数组，元素形状 `{ path, element }`：

```jsx
import MyFeaturePage from './MyFeaturePage'

export default [
  { path: '/my-feature', element: <MyFeaturePage /> },
]
```

可选的具名导出 `nav` 用于让入口自动出现在导航栏末尾（label/path）：

```jsx
export const nav = [{ label: '中文名', path: '/my-feature' }]
```

不导出 `nav` 则该功能不出现在导航栏。`navItems` 为空时 Navbar 不渲染任何额外节点。

## 工作原理

`src/appRoutes.jsx` 用 `import.meta.glob('./features/*/routes.{js,jsx}', { eager: true })` 收集所有 feature 的路由数组与 nav 数组，拼接 `src/legacyRoutes.jsx`（存量路由清单）后统一渲染。
