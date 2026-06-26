# anticraft

> 以匠心为刃，破常规之笼。

**anticraft** 是一个全栈博客系统，包含品牌首页展示、用户认证、博客文章管理等功能。暗色主题设计，支持分类筛选。

---

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| **前端** | React 18 + Vite 5 | 纯 CSS 暗色主题动画页面 |
| **前端路由** | react-router-dom v7 | SPA 路由，博客详情/编辑等 |
| **后端** | Python FastAPI | RESTful API 服务 |
| **数据库** | MySQL 8.4 | 用户与博客数据持久化 |
| **认证** | JWT + bcrypt | 密码 SHA-256 预哈希后 bcrypt 加密 |

---

## 快速开始

### 前置环境

- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) 3.11+
- [MySQL](https://dev.mysql.com/downloads/mysql/) 8.0+

### 1. 克隆并安装前端依赖

```bash
cd anticraft
npm install
```

### 2. 配置后端 Python 环境

```bash
# 创建虚拟环境（已有则跳过）
python -m venv backend\.venv

# 激活并安装依赖
backend\.venv\Scripts\activate.bat
pip install -r backend\requirements.txt
```

### 3. 配置 MySQL 数据库

确保 MySQL 服务已启动，然后创建数据库：

```bash
mysql -u root -p -e "CREATE DATABASE anticraft CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 4. 配置环境变量

编辑项目根目录的 `.env` 文件：

```env
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=anticraft
SECRET_KEY=随机长字符串用于JWT加密
```

### 5. 启动

#### 方式一：一键启动（前后端同时运行）

```bash
npm run start
```

#### 方式二：分别启动

```bash
# 终端 1 — 后端
npm run back

# 终端 2 — 前端
npm run dev
```

### 6. 访问

| 页面 | 地址 |
|------|------|
| 首页 | http://localhost:3000 |
| 博客列表 | http://localhost:3000/blogs |
| 登录/注册 | http://localhost:3000/auth |
| API 文档 | http://127.0.0.1:8000/docs |
| 健康检查 | http://127.0.0.1:8000/api/health |

---

## 项目结构

```
anticraft/
├── .env                     # 数据库 & JWT 配置（不提交 Git）
├── .gitignore
├── package.json             # npm 项目配置
├── vite.config.js           # Vite 配置 + /api 代理
├── index.html               # 入口 HTML
├── anticraft.nginx.conf     # Nginx 配置模板（部署用）
│
├── backend/                 # Python FastAPI 后端
│   ├── .venv/               # Python 虚拟环境
│   ├── requirements.txt     # Python 依赖
│   ├── main.py              # FastAPI 应用入口 & 所有 API 路由
│   ├── database.py          # MySQL 连接 & 会话管理
│   ├── models.py            # SQLAlchemy 模型（User, Blog）
│   ├── schemas.py           # Pydantic 请求/响应模型
│   └── auth.py              # 密码加密 + JWT 令牌
│
├── src/                     # React 前端
│   ├── main.jsx             # React 入口（BrowserRouter）
│   ├── App.jsx              # 路由 & 首页组件
│   ├── App.css              # 首页样式
│   ├── index.css            # 全局变量 & 基础样式
│   ├── components/
│   │   └── Navbar.jsx       # 共享导航栏组件
│   └── pages/
│       ├── AuthPage.jsx     # 登录/注册（双栏合一）
│       ├── LoginPage.jsx    # 独立登录页
│       ├── RegisterPage.jsx # 独立注册页
│       ├── ResetPasswordPage.jsx
│       ├── BlogListPage.jsx # 博客列表（含分类筛选）
│       ├── BlogDetailPage.jsx # 博客详情
│       ├── BlogEditorPage.jsx # 博客创建/编辑
│       ├── ProfileEdit.jsx  # 编辑个人资料
│       ├── Auth.css
│       ├── Blog.css
│       └── ProfileEdit.css
│
├── log/                     # 开发日志
│   └── 2026-06-26.md
│
├── deploy.bat               # 全量部署（构建 + 上传 + 迁移 + 重启）
├── deploy-backend.bat       # 仅部署后端
├── deploy-fresh-server.bat  # 从零初始化服务器
├── deploy-config.bat        # 部署配置（IP/密码/路径）
├── README.md
├── warning.md               # 常见部署错误记录
└── todo.md                  # 任务清单
```

---

## API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/health` | 健康检查 | 否 |
| `POST` | `/api/register` | 用户注册，返回 JWT | 否 |
| `POST` | `/api/login` | 用户登录，返回 JWT | 否 |
| `GET` | `/api/user/me` | 获取当前用户信息 | Bearer Token |
| `PUT` | `/api/user/profile` | 更新昵称/头像 | Bearer Token |
| `GET` | `/api/user/check-username` | 检查用户名是否存在 | 否 |
| `PUT` | `/api/user/reset-password` | 重置密码 | 否 |
| `GET` | `/api/blogs` | 博客列表（分页，支持 `?category=` 筛选） | 否 |
| `GET` | `/api/blogs/{id}` | 博客详情 | 否 |
| `POST` | `/api/blogs` | 创建博客（需分类） | Bearer Token |
| `PUT` | `/api/blogs/{id}` | 更新博客 | Bearer Token（仅作者） |
| `DELETE` | `/api/blogs/{id}` | 删除博客 | Bearer Token（仅作者） |

### 注册示例

```bash
curl -X POST http://127.0.0.1:8000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "123456"}'
```

### 登录示例

```bash
curl -X POST http://127.0.0.1:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "123456"}'
```

### 创建博客（带分类）

```bash
curl -X POST http://127.0.0.1:8000/api/blogs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"title": "文章标题", "category": "技术讨论", "content_md": "## Markdown 内容"}'
```

---

## 前端页面

| 页面 | 路由 | 说明 |
|------|------|------|
| **首页** | `/` | Hero + 项目展示 + 联系信息 |
| **博客列表** | `/blogs` | 博客卡片 + 分类筛选（全部/技术讨论/更新日志） |
| **博客详情** | `/blogs/{id}` | Markdown 渲染 + 作者操作（编辑/删除） |
| **写文章** | `/blogs/new` | 标题 + 分类 + Markdown 编辑器 + 实时预览 |
| **编辑文章** | `/blogs/{id}/edit` | 同上，预填现有内容 |
| **登录** | `/login` | 用户名 + 密码 |
| **注册** | `/register` | 用户名 + 密码 + 确认密码 |
| **重置密码** | `/reset-password` | 两步验证：用户名 → 新密码 |
| **编辑资料** | `/profile` | 昵称 + 头像 URL + 退出登录 |

---

## 设计要点

- **暗色主题** — `#0a0a0f` 深底色 + 紫/青色渐变
- **玻璃态导航** — `backdrop-filter: blur(20px)` 磨砂效果
- **入场动画** — 页面加载后各模块依次淡入上移
- **背景网格 + 光晕** — 营造沉浸式氛围
- **全响应式** — 适配手机（480px）、平板（768px）与桌面

### 快速换肤

编辑 `src/index.css` 中的 CSS 变量：

```css
--bg-primary: #0a0a0f;      /* 背景色 */
--accent-1: #6c5ce7;        /* 主色调（紫色） */
--accent-2: #00cec9;        /* 辅色调（青色） */
--text-primary: #f0f0f5;    /* 主文字色 */
```

---

## 生产部署

### 一键部署（推荐）

修改 `deploy-config.bat` 中的服务器信息和密码，然后运行：

```bash
deploy.bat
```

该脚本会自动执行：
1. 构建前端
2. 上传前端产物到服务器
3. 上传后端源码
4. 安装/配置 MySQL
5. 创建 Python 虚拟环境并安装依赖
6. 配置 systemd 服务（anticraft-api）
7. 配置 Nginx 反向代理
8. 自动迁移数据库（新增列等）
9. 验证 API 是否正常

### 手动构建前端

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### Nginx 配置参考

参考 `anticraft.nginx.conf`，静态文件路径 `/var/www/anticraft/dist/`，API 代理到 `127.0.0.1:8000`。

---

## 常见问题

见 `warning.md` 文件，记录了部署和开发中遇到的常见错误及解决方案。
