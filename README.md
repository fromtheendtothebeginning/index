# anticraft · 逆匠

> 以匠心为刃，破常规之笼。

**anticraft**（中文名：**逆匠**）是一个品牌落地页项目。并非反对匠心，而是拒绝被定义的匠心——在秩序中寻找裂痕，在裂痕中创造可能。

## 技术栈

- **React 18** — UI 框架
- **Vite 5** — 构建工具与开发服务器
- **纯 CSS** — 自定义变量、动画、响应式布局（无第三方 UI 库）

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:3000）
npm run dev

# 生产构建
npm run build

# 预览生产构建
npm run preview
```

## 项目结构

```
anticraft/
├── index.html            # 入口 HTML
├── package.json          # 项目配置与依赖
├── vite.config.js        # Vite 配置（React 插件、端口 3000）
├── public/
│   └── favicon.svg       # 品牌图标
└── src/
    ├── main.jsx          # React 入口
    ├── App.jsx           # 首页主组件
    ├── App.css           # 主样式（约 700 行）
    └── index.css         # 全局样式与 CSS 变量
```

## 页面结构

| 区域 | 说明 |
|------|------|
| **导航栏** | 品牌 logo + 锚点导航（关于 / 项目 / 联系） |
| **Hero** | 渐变品牌标题、slogan、CTA 按钮、滚动指示 |
| **关于** | 三张卡片阐述逆匠理念：破格 · 淬炼 · 创造 |
| **项目** | 近期项目展示卡片 |
| **联系** | 邮件与 GitHub 链接 |
| **页脚** | 版权信息与 motto |

## 设计要点

- **暗色主题** — `#0a0a0f` 深底色 + 紫/青色渐变
- **玻璃态导航** — `backdrop-filter: blur(20px)` 磨砂效果
- **入场动画** — 页面加载后各模块依次淡入上移
- **背景网格 + 光晕** — 营造沉浸式氛围
- **全响应式** — 适配手机（480px）、平板（768px）与桌面

## 自定义

编辑 `src/index.css` 中的 CSS 变量即可快速换肤：

```css
--bg-primary: #0a0a0f;      /* 背景色 */
--accent-1: #6c5ce7;        /* 主色调（紫色） */
--accent-2: #00cec9;        /* 辅色调（青色） */
--text-primary: #f0f0f5;    /* 主文字色 */
```

## License

MIT
