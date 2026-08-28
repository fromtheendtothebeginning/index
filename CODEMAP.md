# CODEMAP — anticraft 代码文件功能说明

> 全仓代码地图：每个文件一句话职责 + 关键要点。生成于 v0.9.6 之后（2026-08）。
> 相关文档：`README.md`（部署与使用）、`AGENTS.md`（协作规范）、`warning.md`（排错）、`harness/README.md`（管控框架详情）。

---

## 一、后端（backend/）

FastAPI + SQLAlchemy + MySQL 8。入口 `python backend/main.py`，模块间同目录平铺导入（`from database import ...`）。新业务功能一律放 `features/`，模块级暴露 `router = APIRouter()` 即被自动挂载。

### 入口与基础设施

| 文件 | 职责 |
|---|---|
| `backend/main.py` | 应用瘦启动器：创建 FastAPI 实例、CORS 中间件、请求日志中间件（只记 /api/tools 与 4xx/5xx）、`/api/health` 健康检查；启动时 `init_db()` + `run_migrations()`；**路由自动发现**——扫描 `features/` 下所有含 `router` 变量的模块并挂载。 |
| `backend/database.py` | 数据库连接与会话管理。读根目录 `.env`（回退 `backend/.env`）拼 SQLAlchemy URL；自动检测驱动（优先 mysql-connector-python，回退 pymysql）；导出 `engine / SessionLocal / Base / get_db`；`init_db()` 首次建表；**`run_migrations()` 自动迁移**——为旧表补列（users.role/token_version、blogs.category/project_id/is_featured、comments.parent_id/project_id 等）、邀请码补发、首个管理员提升、站点设置默认行。加新列必须同步写这里。 |
| `backend/models.py` | 全部 ORM 模型（17 张表）：User（role/token_version）、Blog（category/is_featured/project_id）、Project、BlogLike/ProjectLike/ProjectFollow（唯一约束防重复）、Comment（blog_id/project_id 二选一、parent_id 回复树）、CommentLike、Notification、InviteCode（可重复/专属用户）、LeetcodeBinding、FriendLink、AiKey/AiFavorite/AiModel/AiSetting（AI 多厂商配置）、SiteSetting。 |
| `backend/schemas.py` | 全部 Pydantic 请求/响应模型（约 70 个），按业务域分组：认证 Token、博客/项目/评论、通知、管理后台 Admin*、邀请码、友链/站点设置、LeetCode、AI 设置。列表项模型决定 API 对外字段（如 BlogListItem.liked_by_me）。 |
| `backend/auth.py` | 密码加密 & JWT。密码流程 **SHA-256 预哈希 → bcrypt**（绕过 bcrypt 72 字节限制），导出 `hash_password / verify_password`；JWT 用 pyjwt HS256、24 小时过期；SECRET_KEY 从环境变量读取且强制 ≥32 字符否则拒绝启动。 |
| `backend/deps.py` | FastAPI 公共依赖：`_log` 运行日志、`oauth2_scheme(_optional)` 可选鉴权方案、`get_current_user_obj` 强制登录（401）、`require_admin` 管理员门禁（403）、`get_optional_user` 匿名可选用户（公开接口的 liked_by_me 依赖它）、`_verify_token` 含 token_version 校验、`_notify` 站内通知去重写入、`_escape_like` LIKE 转义、`_client_ip`。 |
| `backend/ratelimit.py` | 纯标准库线程安全限流：`SlidingWindow` 滑动窗口计数器（注册/登录按 IP+用户名限速）、`AccountLock` 连续失败锁定账号。实例在 auth_routes 中创建使用。 |
| `backend/constants.py` | 后端共享常量（与前端 src/constants.js 同步维护）：博客分类、角色值、LeetCode GraphQL 地址、CORS 默认来源、**VISION_MODEL_PATTERNS / SPEECH_MODEL_PATTERNS**（识图/语音模型 ID 特征匹配，用于 AI 设置选择器过滤）。 |
| `backend/aisettings.py` | AI 多厂商适配层：`PROVIDERS` 注册表（opencode-go/deepseek/moonshot/qwen/zhipu/minimax/custom…各家的 base_url/api 风格/thinking_levels/sampling 支持位）；API Key **AES 加密存取**（encrypt_secret/decrypt_secret/mask_key，密钥派生自 SECRET_KEY）；`test_chat` 连接测试、`list_models` 拉取可用模型、`_endpoint_url/_build_headers/_build_payload` 请求构造（OpenAI 兼容 chat/completions 协议为主）。 |
| `backend/tools.py` | 视频解析底层工具（供 tool_api 与 video_summary 复用）：B站请求头补丁 `_patch_bilibili_headers`、yt-dlp 参数集 `_ydl_opts`（含 BILIBILI_COOKIE 支持）、`extract_video_info` 元信息解析、`download_video` 三种下载模式（merged 合流/separate 分轨/audio），临时目录生命周期管理。 |

### 业务功能（features/ —— 新功能只加文件，不改旧文件）

| 文件 | 职责 |
|---|---|
| `features/__init__.py` | 空，使 features 成为包供 main.py 自动发现。 |
| `features/auth_routes.py` | 注册 `/api/register`（**必须携带邀请码**；注册成功自动分配该用户专属可重复邀请码）与登录 `/api/login`；接入滑动窗口限流与账号锁定。 |
| `features/users.py` | 当前用户 `/api/user/me`、资料修改、用户名占用检查、**重置密码**（必须用本人专属可重复邀请码，不消耗防接管）、注销账号（级联删除本人数据）。 |
| `features/blogs.py` | 博客 CRUD：列表（分类/关键词/时间过滤，排序 created 精选优先 / likes 点赞数 / comprehensive 综合）带分页；`_attach_blog_stats` 为每篇附加 like_count/comment_count/liked_by_me；正文存 Markdown（content_md）。 |
| `features/projects.py` | 项目 CRUD + 关注：项目聚合多篇博客（blogs.project_id 外键）；`_attach_project_stats` 附加点赞/关注计数与 liked_by_me/followed_by_me；`PUT /projects/{id}/blogs` 维护项目-博客关联。 |
| `features/comments.py` | 评论体系（博客/项目共用一套 Comment 表，blog_id/project_id 二选一）：楼中楼回复（parent_id，父评论归属校验）、通知触发（回复/被评论走 deps._notify 去重）、删除权限校验（本人或管理员）。 |
| `features/likes.py` | 点赞开关三件套：博客/项目/评论（toggle 幂等，返回 liked + 最新 like_count），同步发评论点赞通知。 |
| `features/notifications.py` | 站内信：未读列表（unread_count 徽标数据源）与全部已读标记。 |
| `features/admin.py` | 管理员接口（require_admin 门禁）：用户管理（列表/改角色/改昵称头像密码/删除）、评论管理（全量列表含博客标题**和项目标题 project_title**/删除）、博客管理（撤回/分类/精选）、邀请码（生成/列表/删/改可重复性）。 |
| `features/site.py` | 友情链接 CRUD（公开读 + 管理员写）、站点设置（首页"保持联系"区块 contact_items JSON 单行配置）。 |
| `features/leetcode.py` | LeetCode 刷题榜：绑定 leetcode.cn 用户名后经 GraphQL 抓增量（8.13 起算）；计分规则（简单2/中等4/困难8；困难模式减半、严肃模式简单不计、激励模式 -100 起步 3/6/9 互斥）；调试模式手动改数；公开榜单；60 秒后台心跳线程全量同步；管理员调试接口。 |
| `features/tool_api.py` | 视频解析工具 API（需登录）：info 解析、下载任务（后台线程 + 进度轮询 + 文件下载流）、封面代理（SSRF 白名单校验 `_thumb_host_allowed`）。 |
| `features/video_summary.py` | **视频 AI 总结工具**（最大单文件 ~1100 行）：yt-dlp 拉低清视频 → ffmpeg 音频分片（600s/片）→ 用户语音模型 ASR 转写（支持 OpenAI transcriptions 与小米 MiMo chat_audio 双协议，失败降级）→ 本地 RapidOCR 抽帧识别（**默认禁用**，`ANTICRAFT_ENABLE_OCR=1` 开启；SequenceMatcher 0.9 去重）→ 主模型流式生成 Markdown（SSE `/stream`）→ AI 排版校对 → `_latexize` 公式确定性转 LaTeX；任务状态内存表 + MySQL 历史（video_summaries 表，上限 20 条）+ 断线恢复 active 表；护栏：90 分钟时长上限、24k 字符截断、任务结束释放 OCR 引擎并 GC。 |
| `features/ai_settings_api.py` | AI 设置 REST：多 Key CRUD（加密存储、掩码返回）、当前选择保存（主模型/识图模型/语音模型）、按 Key 拉取可用模型（`?capability=vision|speech` 按 constants 特征过滤）、收藏模型置顶、自定义模型增删、连接测试。 |

## 二、AI 智能体管控框架（harness/）

纯 Python 标准库零依赖，独立于 backend（集成走懒加载），详见 `harness/README.md`。

| 文件 | 职责 |
|---|---|
| `harness/__main__.py` | `python -m harness check [--only 名称]` CLI 入口分发。 |
| `harness/runner.py` | CLI 实现：check（跑检查）/ context（token 预算演示）/ entropy（风险分级演示）三个子命令。 |
| `harness/alerts.py` | 可插拔告警通道抽象。 |
| `harness/core/types.py` | 共享类型定义。 |
| `harness/core/context.py` | 上下文管理：token 预算核算、按优先级裁剪、摘要压缩、滑动窗口。 |
| `harness/core/entropy.py` | 不确定性→熵值度量→风险分级→人工介入决策。 |
| `harness/core/watchdog.py` | 周期自检、失败告警（冷却去重）、行动前 `require()` 强制门禁。 |
| `harness/checks/builtin.py` | 内置检查项：通用检查 + anticraft 后端健康集成。 |
| `harness/tests/test_harness.py` | stdlib unittest 单元测试（`python -m unittest discover -s harness -t .`）。 |

## 三、前端（src/）

React 18 + Vite 5 + react-router-dom v7，无 UI 组件库；每页独立 CSS，主题色集中在 CSS 变量。

### 入口 / 路由 / 共享基建

| 文件 | 职责 |
|---|---|
| `index.html` | SPA 外壳，生产构建注入 CSP meta（vite 插件实现）。 |
| `vite.config.js` | Vite 配置：dev 端口 3000、`/api` 代理到 `127.0.0.1:8000`、生产 CSP 注入插件 cspPlugin。 |
| `src/main.jsx` | React 挂载入口：BrowserRouter 包 App；首帧主题直写 `:root`（无动画闪烁），跨标签页 storage 同步主题；引入 KaTeX 样式。 |
| `src/App.jsx` | 根组件：GoldenMagic 彩蛋 + AppRoutes。 |
| `src/appRoutes.jsx` | 路由注册中心：`import.meta.glob` 收集 `features/*/routes.jsx` 的默认导出（路由数组）与命名导出 nav（导航条目），合并 legacyRoutes 渲染 `<Routes>`；导出 navItems 给 Navbar。新增功能页零改此文件。 |
| `src/legacyRoutes.jsx` | 存量页面路由表：首页、auth、reset-password、blogs 系列、projects 系列、leetcode、tools、profile、admin、my。 |
| `src/i18n/index.js` | i18n 入口：加载 zh.json，导出 `t(key, vars)`——点路径取嵌套键、找不到原样返回 key、`{var}` 占位符插值。切换语言只需替换字典源。 |
| `src/i18n/zh.yml` | 中文文案源文件（21 个顶层键 / 约 683 条），键名规则 `<页面>.<区块>.<条目>`；改文案改这里再跑构建脚本。 |
| `src/i18n/zh.json` | 由 `npm run i18n` 从 zh.yml 生成的 JSON（提交进仓库，前端实际 import 的就是它）。 |
| `scripts/i18n-build.mjs` | 构建脚本：用 yaml 包把 zh.yml 解析写出 zh.json。 |
| `src/constants.js` | 前端共享常量（与 backend/constants.py 同步）：ALL_CATEGORY、BLOG_CATEGORIES 分类值。 |

### utils/

| 文件 | 职责 |
|---|---|
| `src/utils/themes.js` | 主题定义唯一权威源：THEMES（light/dark 的 CSS 变量表）、detectThemeMode（跟随系统/浅色/深色）、颜色解析。 |
| `src/utils/themeTransition.js` | 通用主题渐变引擎：主题色变化时从当前值逐帧 rAF 线性插值到目标色。 |
| `src/utils/dominantColor.js` | 图片主色提取（16 级/通道量化取最高频色，失败降级均值），带缓存；用于项目封面氛围底色。 |
| `src/utils/markdown.js` | 自研轻量 Markdown 渲染器：标题/强调/代码块/链接图片/引用/列表/表格/分隔线/删除线 + KaTeX 行内块公式 + highlight.js 代码高亮。新增语法在此扩展。 |
| `src/utils/aiProviders.js` | AI 提供商注册表（前端侧）：各家 label/baseURL/models/思考深度档位/是否支持温度等采样参数；与 backend/aisettings.py 的 PROVIDERS 保持同步。 |

### components/（全局共享组件，样式在 App.css）

| 文件 | 职责 |
|---|---|
| `components/Navbar.jsx` | 全局导航栏：桌面横排 + ≤768px 移动端抽屉（portal 到 body 规避 backdrop-filter 定位问题）；登录用户头像/未读徽标；登录态有效性轮询（401/404 清除本地态）；平滑滚动锚点跳转。导航文案走 t()。 |
| `components/NavItem.jsx` | 单个导航项：label + 激活态样式 + 下拉 children。 |
| `components/Modal.jsx` | 全站统一确认弹窗（title/message/confirmText/cancelText/onConfirm），替代 window.confirm；默认按钮文案走 i18n。 |
| `components/Icons.jsx` | 图标库：`UiIcon` Feather 风格镂空 stroke 图标（heart/star/message/thumb/视频总结等全套），`ContactIcon` 品牌联系图标（GitHub/微信/B站/知乎等 fill 官方简化形）；CONTACT_ICON_OPTIONS 键清单（显示名经 t('icons.contact.*')）。 |
| `components/CategoryDropdown.jsx` | 通用下拉选择器（复用 nav-dropdown 样式）：value/options/placeholder/closeOnSelect；用于分类筛选与 AI 模型选择。 |
| `components/ActionButton.jsx` | 统一动作按钮（variant/size/icon），映射 .action-btn 样式族。 |
| `components/Reveal.jsx` | 滚动进入视口渐显包装组件（IntersectionObserver），可 as 指定渲染标签；用于卡片列表入场动画。 |
| `components/ProjectCover.jsx` | 项目封面渲染：有图显示图（dominantColor 提取主色做氛围底），无图显示占位背景色。 |
| `components/GoldenMagic.jsx` | 「万物成金魔法」彩蛋：激励模式下分数>0 有概率弹询问窗，确认进入黄金主题 5 分钟倒计时（CSS filter 金色化）。 |

### pages/（每页对应一个路由，各自独立 CSS）

| 文件 | 路由 | 职责 |
|---|---|---|
| `pages/HomePage.jsx` | `/` | 首页：hero 区、近期项目卡（Reveal 动画）、友情链接、保持联系区块（site-settings 数据）、底部 slogan。 |
| `pages/AuthPage.jsx` | `/auth` | 登录/注册双 Tab 合一页；品牌语区、表单校验、密码显隐；注册必填邀请码；成功后写 localStorage token/user 跳首页。 |
| `pages/ResetPasswordPage.jsx` | `/reset-password` | 两步重置：先验证用户名 + 本人专属邀请码，再设置新密码。 |
| `pages/BlogListPage.jsx` | `/blogs` | 博客列表：分类筛选/搜索（400ms 防抖）/时间段/三种排序、网格↔列表视图切换（记忆偏好）、分页、会话内状态恢复；点赞可点击（乐观更新、liked_by_me 红心）；管理员精选/撤回/分类操作。 |
| `pages/BlogDetailPage.jsx` | `/blogs/:id` | 博客详情：Markdown 正文渲染、点赞（红心）、作者/管理员编辑删除（确认弹窗）、所属项目链接、完整评论区（发表/楼中楼回复链面板/评论点赞/删除）、管理员改分类。 |
| `pages/BlogEditorPage.jsx` | `/blogs/new`、`/blogs/:id/edit` | 博客编辑器：标题/正文 Markdown（插入图片 URL/图床提示）、预览、关联项目与分类选择；新建/编辑复用。 |
| `pages/ProjectListPage.jsx` | `/projects` | 项目列表卡片（封面主色底、简介、博客数、关注/点赞数）。 |
| `pages/ProjectDetailPage.jsx` | `/projects/:id` | 项目详情：展示/外链/相关博客列表、点赞与关注 toggle、项目评论区（同博客评论体系交互）。 |
| `pages/ProjectEditorPage.jsx` | `/projects/new`、`/projects/:id/edit` | 项目编辑器：名称/简介 Markdown/封面/背景色/多条外链/关联博客勾选（仅编辑态）。 |
| `pages/LeetCodePage.jsx` | `/leetcode` | 刷题榜：绑定/解绑、我的卡片（增量/累计 statsIncrement/statsTotal 粗体总刷题量/得分）、难度/严肃/激励模式互斥开关（激励进出确认弹窗）、调试模式、榜单表格、刷新与心跳状态。 |
| `pages/AdminPage.jsx` | `/admin` | 管理后台七 Tab：用户（角色/资料/删除）、评论（跳转博主/项目原文 + 删除）、博客（撤回/分类/精选）、邀请码（生成/可重复切换）、友情链接 CRUD、站点设置（联系项 JSON 编辑）、LeetCode 调试。 |
| `pages/MyPage.jsx` | `/my` | 个人中心双 Tab：①通知（未读红点开关、类型图标、全部已读、点击跳转）；②AI 设置（Key 管理 CRUD+设为当前、可用模型列表点选/收藏/自定义、识图与语音模型按能力过滤、思考深度 CategoryDropdown、温度/Top-K 按 provider 支持 显隐、测试连接、采样参数保存）。 |
| `pages/ProfileEdit.jsx` | `/profile` | 资料编辑：昵称/头像 URL、主题模式切换（system/light/dark 即时渐变）、退出登录、注销账号（输入账密双重确认）。 |
| `pages/ToolHomePage.jsx` | `/tools` | 工具导航页：视频解析、视频 AI 总结两张卡片。 |
| `pages/ToolParsePage.jsx` | `/tools/video-parse` | 视频解析工具：粘贴 B站链接 → 信息卡（UP主/时长/清晰度选择）→ 四种下载方式（合流/纯视频/纯音频/分轨）后台任务进度 + 文件下载。 |

### features/（新架构：新功能页面放这里，App/Navbar 零改动）

| 文件 | 职责 |
|---|---|
| `features/video-summary/routes.jsx` | 功能注册样板：default 导出路由数组 `[{path:'/tools/video-summary', element}]`，命名导出 `nav=[{label, path, parent:'/tools'}]`（parent 使条目进"工具"下拉而非顶层）。作为新功能的参考模板。 |
| `features/video-summary/VideoSummaryPage.jsx` | 视频 AI 总结页：左侧历史记录栏（服务端持久化/active 任务恢复）、右侧行为区（链接输入/ASR 开关/生成）、阶段进度条（fetch+ReadableStream 轮询 progress）、SSE 流式渲染中间结果（streamSafeMd 抹掉未闭合数学分隔符防 KaTeX 报错）、复制 MD、AI 配置缺失引导弹窗。 |

### 样式文件（CSS）

约定：全局样式与共享组件样式在 App.css；主题 CSS 变量定义在 index.css；每页私有样式独立成文件放同目录。

| 文件 | 职责 |
|---|---|
| `src/index.css` | 主题变量兜底定义（`:root` / `[data-theme]` / 深色媒体查询，与 utils/themes.js 同步维护）、基础 reset 与全局元素样式。 |
| `src/App.css` | 全局布局 + 共享组件样式：navbar/nav-drawer、`.btn` 按钮族、`.modal-*` 弹窗（所有页面共用，不能搬进页面私有 CSS）、action-btn、nav-dropdown 下拉。 |
| `src/pages/Blog.css` | 博客三页（列表/详情/编辑器）共用：卡片网格/列表行、点赞按钮 liked 红心、评论区全套（评论卡/回复链/点赞）、编辑器工具栏、筛选栏与视图切换。 |
| `src/pages/Project.css` | 项目三页（列表/详情/编辑器）共用：项目卡、封面、关注/点赞按钮、项目评论区。 |
| `src/pages/Auth.css` | 登录注册 + 重置密码两页：品牌区、表单、双 Tab 切换。 |
| `src/pages/AdminPage.css` | 管理后台：Tab 导航、各管理表格/列表、评论项操作行、邀请码面板。 |
| `src/pages/MyPage.css` | 个人中心：通知列表/徽标、AI 设置整套（Key 卡片、模型选择、采样参数滑块）。 |
| `src/pages/LeetCodePage.css` | 榜单：绑定卡、我的成绩卡（模式标签含金色激励态）、榜单表格、调试面板。 |
| `src/pages/ProfileEdit.css` | 资料编辑表单、主题切换控件、注销区。 |
| `src/pages/ToolHomePage.css` / `ToolParsePage.css` | 工具导航卡片；视频解析页信息卡/下载任务面板。 |
| `src/features/video-summary/VideoSummaryPage.css` | 视频 AI 总结页布局：左历史栏 + 右行为区双栏（复用 ToolParsePage.css 基础）。 |

## 四、说明

- **不在本表**：`.env` / `deploy*.bat` / `restart-*.bat` / `run-*-hidden.cmd` / `check_db.sh`（本地或凭据文件，已 gitignore，内容不入文档）；`dist/`、`node_modules/`、`log/`（构建产物与运行日志）。
- **新功能开发约定**：后端建 `backend/features/<名>.py`（模块级 `router`），前端建 `src/features/<kebab-name>/`（routes.js(x) 注册路由/导航）；字符串常量只进两端 constants 文件；文案进 `src/i18n/zh.yml`。
