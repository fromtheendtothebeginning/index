# constants.py — 全站可调常量（字符串集中维护，改这里即可生效）

# 博客分类（与前端 src/constants.js 的 BLOG_CATEGORIES 保持同步）
BLOG_CATEGORIES = ["技术讨论", "更新日志", "娱乐论坛"]

# 用户角色
ROLE_USER = "user"
ROLE_ADMIN = "admin"

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
    "grok", "minimax-m3", "minimax-vl", "kimi", "qwen3.8", "qwen3.7",
    "qwen3.5-omni", "qwen-vl", "qwen2.5-vl", "-vl", "4v", "internvl",
    "glm-5v", "glm-4v", "glm-ocr",
)
# 语音识别（ASR）：whisper 系 / 阿里 qwen-audio-asr / 智谱 GLM-ASR / omni 语音识别
SPEECH_MODEL_PATTERNS = (
    "whisper", "sensevoice", "sense-voice", "paraformer", "fun-asr",
    "qwen-audio", "qwen2-audio", "qwen3.5-omni", "asr", "glm-asr",
    "gpt-4o-transcribe", "gpt-4o-mini-transcribe",
)
