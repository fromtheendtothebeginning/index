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
