# anticraft

> 以匠心为刃，破常规之笼。

**anticraft** 是一个全栈博客系统，包含品牌首页、用户认证（邀请码）、博客管理、点赞评论、管理员后台等功能。淡色主题 + 紫/青渐变辅色，支持 Markdown 渲染、分类筛选与全响应式布局。

---

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| **前端** | React 18 + Vite 5 | 纯 CSS 主题动画页面 |
| **前端路由** | react-router-dom v7 | SPA 路由 |
| **Markdown** | 自研渲染器 | 支持标题/列表/代码块/表格/引用/图片/链接等完整语法 |
| **后端** | Python FastAPI | RESTful API 服务 |
| **数据库** | MySQL 8.0+ | 用户、博客、评论、点赞、邀请码 |
| **认证** | JWT + bcrypt | 密码 SHA-256 预哈希后 bcrypt 加密 |
| **部署** | systemd + Nginx | 反向代理 + 进程守护 |

---

## 功能特性

### 用户系统
- 注册 / 登录 / 重置密码
- **邀请码注册**：新用户必须持邀请码注册，每个用户注册后自动获得一个专属可重复使用邀请码
- 个人资料编辑（昵称、头像 URL）
- 无效账号自动登出（token 失效时前端自动清理）

### 博客系统
- 创建 / 编辑 / 删除博客
- **Markdown 实时预览编辑器**
- 分类筛选：技术讨论 / 更新日志 / 娱乐论坛
- **点赞功能**：同用户对同博客只能赞一次，可取消
- **评论功能**：支持发表、删除自己评论
- 分页列表

### 权限系统
- **角色**：`user`（普通用户）/ `admin`（管理员）
- 管理员后台 `/admin`，四个 Tab：
  - **用户管理**：查看所有用户、切换 user/admin 角色
  - **评论管理**：查看所有评论、删除任意评论
  - **博客管理**：查看所有博客、撤回任意博客、修改分类
  - **邀请码**：生成、查看、删除、切换可重复使用
- 管理员在博客列表页和详情页可直接编辑/撤回/改分类（无需进入后台）

### 界面与交互
- 淡色主题 + 紫青渐变点缀
- 玻璃态导航栏、入场动画、Tab 切换动画
- 统一 Modal 确认弹窗（替代浏览器原生 confirm）
- 全响应式（手机 480px / 平板 768px / 桌面）

---

## 快速开始

### 前置环境

- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) 3.11+
- [MySQL](https://dev.mysql.com/downloads/mysql/) 8.0+

### 1. 安装前端依赖

```bash
cd anticraft
npm install
```

### 2. 配置后端 Python 环境

```bash
python -m venv backend\.venv
backend\.venv\Scripts\activate.bat
pip install -r backend\requirements.txt
```

### 3. 配置 MySQL

```bash
mysql -u root -p -e "CREATE DATABASE anticraft CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 4. 配置环境变量

编辑项目根目录 `.env`：

```env
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=anticraft
SECRET_KEY=随机长字符串用于JWT加密
```

### 5. 启动

```bash
# 一键启动（前后端同时）
npm run start

# 或分别启动
npm run back   # 终端 1 — 后端
npm run dev    # 终端 2 — 前端
```

### 6. 访问

| 页面 | 地址 |
|------|------|
| 首页 | http://localhost:3000 |
| 博客列表 | http://localhost:3000/blogs |
| 登录/注册 | http://localhost:3000/auth |
| 管理员后台 | http://localhost:3000/admin |
| API 文档 | http://127.0.0.1:8000/docs |
| 健康检查 | http://127.0.0.1:8000/api/health |

> 后端默认以 `reload=False` 启动，避免文件改动触发意外重启。

---

## 项目结构

```
anticraft/
├── .env                     # 数据库 & JWT 配置（不提交 Git）
├── .gitignore
├── package.json
├── vite.config.js           # Vite 配置 + /api 代理
├── index.html
│
├── backend/                 # Python FastAPI 后端
│   ├── .venv/               # Python 虚拟环境
│   ├── requirements.txt
│   ├── main.py              # FastAPI 应用入口 & 所有 API 路由
│   ├── database.py          # MySQL 连接 + init_db + run_migrations
│   ├── models.py            # SQLAlchemy 模型（User/Blog/BlogLike/Comment/InviteCode）
│   ├── schemas.py           # Pydantic 请求/响应模型
│   └── auth.py              # 密码加密 + JWT + 角色守卫
│
├── src/                     # React 前端
│   ├── main.jsx
│   ├── App.jsx              # 路由 + 首页
│   ├── App.css
│   ├── index.css            # 全局 CSS 变量
│   ├── components/
│   │   ├── Navbar.jsx
│   │   └── Modal.jsx        # 统一确认弹窗
│   ├── utils/
│   │   └── markdown.js      # Markdown 渲染器
│   └── pages/
│       ├── AuthPage.jsx
│       ├── LoginPage.jsx
│       ├── RegisterPage.jsx
│       ├── ResetPasswordPage.jsx
│       ├── BlogListPage.jsx
│       ├── BlogDetailPage.jsx
│       ├── BlogEditorPage.jsx
│       ├── ProfileEdit.jsx
│       ├── AdminPage.jsx    # 管理员后台
│       ├── Auth.css
│       ├── Blog.css
│       ├── ProfileEdit.css
│       └── AdminPage.css
│
├── log/                     # 开发日志
├── deploy.bat               # 全量部署
├── deploy-backend.bat
├── deploy-fresh-server.bat
├── deploy-config.bat
├── README.md
├── warning.md               # 常见部署错误
└── todo.md                  # 任务清单
```

---

## API 接口

### 系统 / 认证
| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/health` | 健康检查 | 否 |
| `POST` | `/api/register` | 注册（需邀请码） | 否 |
| `POST` | `/api/login` | 登录 | 否 |

### 用户
| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/user/me` | 当前用户信息 | Bearer |
| `PUT` | `/api/user/profile` | 更新昵称/头像 | Bearer |
| `GET` | `/api/user/check-username` | 用户名查重 | 否 |
| `PUT` | `/api/user/reset-password` | 重置密码（需邀请码） | 否 |

### 博客
| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/blogs` | 列表（分页 + `?category=`） | 否 |
| `GET` | `/api/blogs/{id}` | 详情 | 否 |
| `POST` | `/api/blogs` | 创建（需分类） | Bearer |
| `PUT` | `/api/blogs/{id}` | 更新（仅作者） | Bearer |
| `DELETE` | `/api/blogs/{id}` | 删除（仅作者） | Bearer |

### 点赞 / 评论
| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `POST` | `/api/blogs/{id}/like` | 点赞 / 取消点赞 | Bearer |
| `GET` | `/api/blogs/{id}/comments` | 评论列表 | 否 |
| `POST` | `/api/blogs/{id}/comments` | 发表评论 | Bearer |
| `DELETE` | `/api/comments/{id}` | 删除评论（作者或管理员） | Bearer |

### 管理员（需 admin 角色）
| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/users` | 用户列表 |
| `PUT` | `/api/admin/users/{id}/role` | 切换角色 |
| `GET` | `/api/admin/comments` | 全部评论 |
| `DELETE` | `/api/admin/comments/{id}` | 删除任意评论 |
| `GET` | `/api/admin/blogs` | 全部博客 |
| `DELETE` | `/api/admin/blogs/{id}` | 撤回任意博客 |
| `PUT` | `/api/admin/blogs/{id}/category` | 修改博客分类 |
| `POST` | `/api/admin/invite-codes` | 生成邀请码 |
| `GET` | `/api/admin/invite-codes` | 邀请码列表 |
| `DELETE` | `/api/admin/invite-codes/{id}` | 删除邀请码 |
| `PUT` | `/api/admin/invite-codes/{id}/reusable` | 切换可重复使用 |

完整接口文档：http://127.0.0.1:8000/docs

---

## 前端页面

| 页面 | 路由 | 说明 |
|------|------|------|
| **首页** | `/` | Hero + 项目展示 + 联系信息 |
| **博客列表** | `/blogs` | 卡片网格 + 分类筛选 + 分页 |
| **博客详情** | `/blogs/{id}` | Markdown 渲染 + 点赞 + 评论 + 作者/管理员操作 |
| **写文章** | `/blogs/new` | Markdown 编辑器 + 实时预览 |
| **编辑文章** | `/blogs/{id}/edit` | 同上，预填内容 |
| **登录** | `/login` | 用户名 + 密码 |
| **注册** | `/register` | 用户名 + 密码 + 邀请码 |
| **登录/注册合一** | `/auth` | 双栏切换 |
| **重置密码** | `/reset-password` | 用户名 + 邀请码 + 新密码 |
| **编辑资料** | `/profile` | 昵称 + 头像 + 退出登录 |
| **管理员后台** | `/admin` | 用户/评论/博客/邀请码四 Tab |

---

## 设计要点

- **淡色主题** — `#f8f9fa` 背景配 `#1a1a2e` 深色字体，避免灰色字体保证可读性
- **紫青渐变点缀** — `#6c5ce7`（紫）+ `#00cec9`（青）用于按钮、链接、强调色
- **玻璃态导航** — `backdrop-filter: blur(20px)`
- **入场动画** — 模块依次淡入上移
- **全响应式** — 适配手机 / 平板 / 桌面

### 快速换肤

编辑 `src/index.css` 中的 CSS 变量：

```css
--bg-primary: #f8f9fa;      /* 背景色 */
--text-primary: #1a1a2e;    /* 主文字色 */
--accent-1: #6c5ce7;        /* 主色调（紫色） */
--accent-2: #00cec9;        /* 辅色调（青色） */
```

---

## 数据库自动迁移

后端启动时 `run_migrations()` 会自动：
1. `users` 表新增 `role` 列（默认 `user`）
2. `blogs` 表新增 `category` 列
3. `invite_codes` 表新增 `is_reusable`、`owner_user_id` 列
4. 为所有没有专属邀请码的已存在用户分配一个可重复使用邀请码
5. 将 `end` 用户提升为管理员（部署初始化用）

---

## 生产部署

### 一键部署（推荐）

修改 `deploy-config.bat` 中的服务器信息和密码，然后运行：

```bash
deploy.bat
```

脚本自动执行：
1. 构建前端（vite build）
2. 上传前端到 `/var/www/anticraft/dist`
3. 上传后端到 `/var/www/anticraft/backend`
4. 检查/安装 MySQL，设置 root 密码，创建数据库
5. 创建 Python venv 并安装依赖
6. 配置 systemd 服务 `anticraft-api`
7. 配置 Nginx 反向代理
8. 重启后端（触发自动迁移）
9. 验证 API 健康

### 手动构建

```bash
npm run build    # 产物输出到 dist/
```

### Nginx 配置参考

见 `anticraft.nginx.conf`：静态文件 `/var/www/anticraft/dist/`，`/api/` 代理到 `127.0.0.1:8000`。

---

## 常见问题

见 `warning.md`，记录了 10 类部署和开发中遇到的常见错误及解决方案。
