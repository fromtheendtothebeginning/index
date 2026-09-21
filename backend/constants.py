# constants.py — 全站可调常量（字符串集中维护，改这里即可生效）

# 博客分类（与前端 src/constants.js 的 BLOG_CATEGORIES 保持同步）
BLOG_CATEGORIES = ["技术讨论", "更新日志", "娱乐论坛"]

# 用户角色
ROLE_USER = "user"
ROLE_ADMIN = "admin"

# 初始化管理员用户名（数据库迁移时提升为管理员的目标账号，见 run_migrations）
BOOTSTRAP_ADMIN_USERNAME = "end"

# 开放平台（账号绑定）权限范围：key → 授权页展示的中文说明。
# 新增范围 = 这里加一项 + features/open_platform.py 加对应数据接口 + docs/account-binding-api.md 更新。
# 存储格式：BindToken.scope / BindCode.scope 为空格分隔的 key 串，profile 恒包含（向后兼容旧令牌）。
OPEN_SCOPES = {
    "profile": "账号基础资料（用户名、昵称、头像、注册时间）",
    "blogs:read": "读取你发布的公开博客列表（只读）",
    "leetcode:read": "读取你的 LeetCode 绑定与刷题数据（只读）",
}
OPEN_SCOPE_DEFAULT = "profile"

# LeetCode
LEETCODE_GRAPHQL = "https://leetcode.cn/graphql"

# 本地开发 CORS 默认来源（环境变量 CORS_ORIGINS 可覆盖）
DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:3300,http://127.0.0.1:3300"
)

# AI 模型能力分类（按模型 ID 子串/前缀匹配，用于识图/语音选择器过滤）
# 依据厂商官方文档调查（2026-08）：
#   MiniMax M3 = 多模态 Chat 输入；Kimi K3/K2.7-Code/K2.6 = 图片视频输入；
#   Qwen3.8-max/Qwen3.7-plus/Qwen3.5-omni-plus = 百炼图像理解；GLM 视觉在 GLM-5V/4V 独立系列；
#   DeepSeek 视觉在 *-vision-exp；Grok/GPT 系原生多模态。
VISION_MODEL_PATTERNS = (
    "vision", "multimodal", "gemini", "gpt-4o", "gpt-4-vision", "gpt-5",
    "grok", "minimax-m3", "minimax-vl", "kimi", "mimo",
    "qwen3.8", "qwen3.7",
    "qwen3.5-omni", "qwen-vl", "qwen2.5-vl", "-vl", "4v", "internvl",
    "glm-5v", "glm-4v", "glm-ocr",
)
# 语音识别（ASR）：whisper 系 / 阿里 qwen-audio-asr / 智谱 GLM-ASR / omni 语音识别
SPEECH_MODEL_PATTERNS = (
    "whisper", "sensevoice", "sense-voice", "paraformer", "fun-asr",
    "qwen-audio", "qwen2-audio", "qwen3.5-omni", "asr", "glm-asr",
    "gpt-4o-transcribe", "gpt-4o-mini-transcribe",
)
