# anticraft · 逆匠

> 以匠心为刃，破常规之笼。

**anticraft**（中文名：**逆匠**）是一个全栈品牌落地页项目，包含品牌展示首页与用户认证系统。并非反对匠心，而是拒绝被定义的匠心——在秩序中寻找裂痕，在裂痕中创造可能。

---

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| **前端** | React 18 + Vite 5 | 纯 CSS 暗色主题动画页面 |
| **前端路由** | react-router-dom | 首页 `/` + 认证页 `/auth` |
| **后端** | Python FastAPI | RESTful API 服务 |
| **数据库** | MySQL 8.4 | 用户数据持久化 |
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

复制项目根目录的 `.env` 文件，修改 `DB_PASSWORD` 为你的 MySQL 密码：

```env
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=anticraft
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
│
├── backend/                 # Python FastAPI 后端
│   ├── .venv/               # Python 虚拟环境
│   ├── requirements.txt     # Python 依赖
│   ├── main.py              # FastAPI 应用入口 & API 路由
│   ├── database.py          # MySQL 连接 & 会话管理
│   ├── models.py            # SQLAlchemy User 模型
│   ├── schemas.py           # Pydantic 请求/响应模型
│   └── auth.py              # 密码加密 + JWT 令牌
│
├── public/
│   └── favicon.svg
│
├── src/                     # React 前端
│   ├── main.jsx             # React 入口（BrowserRouter）
│   ├── App.jsx              # 路由 & 首页组件
│   ├── App.css              # 首页样式（~700 行）
│   ├── index.css            # 全局变量 & 基础样式
│   └── pages/
│       ├── AuthPage.jsx     # 登录/注册页面
│       └── Auth.css         # 认证页面样式
│
├── start-backend.bat        # 后端启动脚本
├── start-frontend.bat       # 前端启动脚本
└── README.md
```

---

## API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/health` | 健康检查 | 否 |
| `POST` | `/api/register` | 用户注册，返回 JWT | 否 |
| `POST` | `/api/login` | 用户登录，返回 JWT | 否 |
| `GET` | `/api/user/me` | 获取当前用户信息 | Bearer Token |

### 注册示例

```bash
curl -X POST http://127.0.0.1:8000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "email": "test@example.com", "password": "123456"}'
```

### 登录示例

```bash
curl -X POST http://127.0.0.1:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "123456"}'
```

---

## 前端页面

| 区域 | 说明 |
|------|------|
| **导航栏** | 品牌 logo + 锚点导航（关于 / 项目 / 联系）+ 登录按钮 |
| **Hero** | 渐变品牌标题、slogan、CTA 按钮、滚动指示 |
| **关于** | 三张卡片阐述逆匠理念：破格 · 淬炼 · 创造 |
| **项目** | 近期项目展示卡片 |
| **联系** | 邮件与 GitHub 链接 |
| **页脚** | 版权信息与 motto |
| **登录/注册** | 双栏布局，左侧品牌展示，右侧表单，支持登录/注册切换 |

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

### 构建前端

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### Nginx 配置参考

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/anticraft/dist;
    index index.html;

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## License

MIT
