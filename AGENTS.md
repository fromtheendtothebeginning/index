# AGENTS.md — anticraft · 逆匠

全栈博客：React 18 + Vite 5 前端 / FastAPI + SQLAlchemy 后端 / MySQL 8。完整文档见 `README.md`，部署排错见 `warning.md`，任务清单见 `todo.md`。

## 常用命令
- `npm run dev` — Vite 前端，端口 3000，`/api` 代理到 `127.0.0.1:8000`
- `npm run back`（=`backend`）— 后端：`cmd /c "backend\.venv\Scripts\activate.bat && python backend\main.py"`，uvicorn `main:app` 端口 8000，`reload=False`（改后端代码后需手动重启）
- `npm run start` — 两个新窗口分别启动前后端
- `npm run build` — 构建前端到 `dist/`
- **没有测试框架、没有 linter/typecheck**。验证方式：启动后 `curl http://127.0.0.1:8000/api/health`，或 `npm run build` 确认构建通过。

## 完成后的默认动作
- 每次任务完成并验证通过后，**自动启动本地前后端并保持存活**，向用户汇报地址与端口：
  - 前端 http://localhost:3000（`/api` 经 Vite 代理到后端）
  - 后端 http://127.0.0.1:8000（本机若 8000 被 Windows/Hyper-V 排除区间占用，改用 18000 并同步 `vite.config.js` 代理；端口说明见 `log/acceptance-2026-08-06.md`）
- 启动方式：用 **agent 内部终端**（Bash 工具，常驻用 `run_in_background`）启动，**不要打开新的终端弹窗/新窗口**（用户明确要求，2026-08-12）；日志写 `log/back.out.log` / `log/fe.out.log`。
- **部署红线：未经用户明确同意，禁止运行任何部署脚本（`deploy.bat` / `deploy-backend.bat` / `deploy-fresh-server.bat` 等，`deploy-config.bat` 是共享凭据来源）或发布到服务器**。完成功能后只启动本地服务供验收，等用户指示「发布到服务器并git」再部署。**代理不得读取、展示或上传这些脚本中的任何凭据/密码**——凭据仅由用户本人运行脚本时使用，代理一概不接触。

## 协作与流程规则
- **Todo 管理**：每个 todo 完成并验证后立即在 todo 列表打钩（`todowrite` 更新状态）；**全部完成后归档清理**，不要遗留已完成的旧 todo 一直挂在右侧，进入下一任务前清空/替换列表。
- **读图**：需要读图/截图/分析图片时，**先判断当前模型是否能直接读图**——用 read 工具读取图片，若返回的图片可解析（模型支持图像输入）则直接读，**不用 skill**；若返回「模型不支持图像输入」（本仓库当前模型 deepseek-v4-flash 即如此），再走 `vision-reader` skill。**本机该 skill 的脚本缺 PIL/torch 等重型依赖未安装——优先用零依赖现成方案**：Windows 自带 OCR（WinRT，PowerShell 调用）+ System.Drawing 像素采样（`GetPixel` 验证颜色），实测可读截图文字与按钮颜色；避免为一次性读图安装 GB 级依赖。
- **分工**：主代理负责分发任务（派子代理）、定接口契约与验收总结，保持上下文清洁；具体实现由子代理（general/explore）完成。

## 后端
- 虚拟环境 `backend/.venv`（Python 3.14）。入口是根目录的 `python backend/main.py`，main.py 内部用同目录相对导入（`from database import ...`）。
- 依赖锁版本，勿随意升级：`mysql-connector-python==8.4.0`（9.x 兼容问题）、`bcrypt==5.0.0`（passlib 不兼容，直接 `import bcrypt`）、`pyjwt`（不用 python-jose，避免 C 扩展编译）。
- `.env`：`database.py` 优先读项目根 `.env`，回退 `backend/.env`（服务器用），`.env` 已 gitignore。

## 认证与密码（易错）
- 密码流程：SHA-256 预哈希 → bcrypt（绕过 bcrypt 72 字节限制）。所有密码处理必须走 `backend/auth.py` 的 `hash_password` / `verify_password`，不要自行实现。
- JWT：pyjwt / HS256 / 24h。前端 token 存 `localStorage.token`、用户信息存 `localStorage.user`，请求头 `Authorization: Bearer <token>`。
- 公开接口（博客列表/详情）用 `oauth2_scheme_optional` 附带当前用户信息（决定 `liked_by_me`），未登录返回 None 而非 401。

## 数据库迁移（关键）
- 启动时 `init_db()` 只建新表；已有表的新增列必须写进 `database.py` 的 `run_migrations()`（ALTER TABLE 逻辑），否则旧库报 `Unknown column`。在 `models.py` 加列时务必同步迁移逻辑。
- **`create_all` 不会为已存在的同名旧表补列**：`projects` 表是早期已删功能的遗留表（含 `owner_id`/`image_url`/`tags`/`is_featured` 旧列），曾导致 INSERT 报缺列、`Field 'owner_id' doesn't have a default value`。库中若存在同名的遗留旧表，必须在 `run_migrations()` 里补齐新列并把阻塞的 NOT NULL 旧列改为可空。
- 迁移还会：为无专属邀请码的用户补发可重复使用邀请码；把用户 `end` 提升为 admin（首个管理员账号）。

## 业务规则
- 注册必须携带邀请码，无邀请码无法注册；每个新用户自动获得一个可重复使用的专属邀请码；重置密码必须使用**本人专属**可重复邀请码（不消耗，防止接管他人账号）。
- 权限用 `User.role`（`user`/`admin`），后端 `require_admin` 依赖拦截 403，前端 `/admin` 页面。
- 博客分类是固定中文字符串：`技术讨论` / `更新日志` / `娱乐论坛`。前端导航下拉与后端 `?category=` 共享，改动需两端同步。

## 前端
- 无 UI 组件库；Markdown 渲染为自研 `src/utils/markdown.js`，新增语法改它。
- 确认弹窗统一用 `src/components/Modal.jsx`，不用 `window.confirm`。
- 每页独立 CSS 文件；主题色在 `src/index.css` 的 CSS 变量（`--bg-primary` / `--text-primary` / `--accent-1` / `--accent-2`）。
- react-router-dom v7，路由集中在 `src/App.jsx`，页面在 `src/pages/`。

## harness（AI 智能体管控框架，顶层目录）
- 纯 Python 标准库，零第三方依赖；不修改 `backend/` 代码，后端集成走懒加载。
- 三子系统：`core/context.py` 上下文 token 预算/压缩、`core/entropy.py` 不确定性→风险分级→人工介入、`core/watchdog.py` 周期自检+告警+`require()` 强制门禁。
- 命令：`python -m harness check [--only 名称]`；演示 `context`/`entropy`；测试 `python -m unittest discover -s harness -t .`。建议用 `backend\.venv\Scripts\python.exe` 运行。详见 `harness/README.md`。

## 经验与提醒（重构后勿回退）
- 登录/注册统一走 `/auth`（双 Tab 合一页），`/login` 仅重定向到 `/auth`。新增认证链接/跳转一律指 `/auth`，勿重建 `LoginPage`/`RegisterPage`。
- 共享组件样式（`.btn` / `.navbar` / `.modal-*` 弹窗）统一在 `App.css`。Modal 弹窗样式必须在 App.css，勿搬回页面私有 CSS（如 Blog.css），否则 AdminPage 等不加载 Blog.css 的页面弹窗样式丢失。
- 已删除文件勿恢复：`context.md`（过时）、`log/2026-06-30.md`（描述已移除的 Project/Category 功能）、`anticraft.nginx.conf`（与 deploy.bat 内联生成的 Nginx 配置重复）。
- `check_db.sh` 含硬编码服务器密码，已 gitignore，勿提交 git。
- models.py 勿新增仅序列化/零读写的字段（`User.email` 教训）；在 models.py 加列必须同步 `database.py` 的 `run_migrations()`。
- 大型多步骤任务优先派子代理实施，主脑负责架构、接口约定与验证，保持上下文清洁。

## 部署（Windows → 阿里云 47.100.125.150）
- 迭代部署跑本地 `deploy.bat`（已 gitignore，仅本机存在）：构建前端、SCP 上传前后端、装依赖、重启 systemd 服务 `anticraft-api`、reload Nginx。同目录还有 `deploy-backend.bat`（仅传后端+重启）、`deploy-fresh-server.bat`（全新服务器初始化）、`deploy-config.bat`（SSH/凭据共享配置，被其余脚本引用）——均含服务器凭据，同样禁止未经同意运行。**代理不得读取/展示这些脚本中的凭据内容**，部署与凭据处理只由用户本人执行。
- `deploy.bat` 硬编码服务器 DB 密码（已 gitignore，仅本机存在），并覆盖生成 `backend/.env`。
- Windows cmd 中 SSH 命令的 `&&`/多行字符串会被错误拆分（warning.md #2/#10），修改部署脚本时注意。
- 服务器数据库检查可用 `check_db.sh`。
