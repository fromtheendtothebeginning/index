# schemas.py — Pydantic 请求/响应模型

from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional


# ── 请求 ──

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, description="用户名")
    password: str = Field(..., min_length=6, max_length=128, description="密码")
    invite_code: str = Field(..., min_length=1, max_length=64, description="注册邀请码")


class LoginRequest(BaseModel):
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")


class ResetPasswordRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, description="用户名")
    new_password: str = Field(..., min_length=6, max_length=128, description="新密码")
    invite_code: str = Field(..., min_length=1, max_length=64, description="邀请码验证")


class UpdateProfileRequest(BaseModel):
    nickname: Optional[str] = Field(None, max_length=50, description="昵称")
    avatar_url: Optional[str] = Field(None, max_length=500, description="头像 URL")


class DeleteAccountRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50, description="账号（需与当前登录一致）")
    password: str = Field(..., min_length=1, max_length=128, description="密码验证")


# ── 响应 ──

class UserResponse(BaseModel):
    id: int
    username: str
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    role: str = "user"
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class MessageResponse(BaseModel):
    message: str


# ── 博客请求 ──

class CreateBlogRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="文章标题")
    category: Optional[str] = Field(None, max_length=50, description="分类：技术讨论 / 更新日志 / 娱乐论坛")
    content_md: str = Field(..., min_length=1, max_length=65535, description="Markdown 内容")
    project_id: Optional[int] = None


class UpdateBlogRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200, description="文章标题")
    category: Optional[str] = Field(None, max_length=50, description="分类：技术讨论 / 更新日志 / 娱乐论坛")
    content_md: Optional[str] = Field(None, min_length=1, max_length=65535, description="Markdown 内容")
    project_id: Optional[int] = None


# ── 项目请求 ──

class ProjectLinkItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="链接名称，如 GitHub/下载")
    url: str = Field(..., min_length=1, max_length=500, description="链接地址")


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="项目名")
    description: Optional[str] = Field(None, max_length=65535, description="项目简介")
    cover_url: Optional[str] = Field(None, max_length=500, description="封面图床 URL")
    tags: Optional[list[str]] = Field(None, description="项目标签列表")
    bg_color: Optional[str] = Field(None, max_length=9, description="自定义封面背景色，如 #6c5ce7")
    link_url: Optional[str] = Field(None, max_length=500, description="项目链接（GitHub/下载，可自定义）")
    links: Optional[list[ProjectLinkItem]] = None


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200, description="项目名")
    description: Optional[str] = Field(None, max_length=65535, description="项目简介")
    cover_url: Optional[str] = Field(None, max_length=500, description="封面图床 URL")
    tags: Optional[list[str]] = Field(None, description="项目标签列表")
    bg_color: Optional[str] = Field(None, max_length=9, description="自定义封面背景色，如 #6c5ce7")
    link_url: Optional[str] = Field(None, max_length=500, description="项目链接（GitHub/下载，可自定义）")
    links: Optional[list[ProjectLinkItem]] = None


class UpdateProjectBlogsRequest(BaseModel):
    """项目编辑界面批量设置关联博客（全量替换）"""
    blog_ids: list[int] = Field(..., description="本项目关联的博客 ID 列表")


# ── 博客响应 ──

class BlogAuthorResponse(BaseModel):
    id: int
    username: str
    nickname: Optional[str] = None

    model_config = {"from_attributes": True}


class ProjectSummaryResponse(BaseModel):
    """博客上展示的项目摘要"""
    id: int
    name: str
    model_config = {"from_attributes": True}


class BlogResponse(BaseModel):
    id: int
    title: str
    category: Optional[str] = None
    content_md: str
    author_id: int
    author: Optional[BlogAuthorResponse] = None
    project_id: Optional[int] = None
    project: Optional[ProjectSummaryResponse] = None
    is_featured: bool = False
    like_count: int = 0
    comment_count: int = 0
    liked_by_me: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BlogListItem(BaseModel):
    id: int
    title: str
    category: Optional[str] = None
    author_id: int
    author: Optional[BlogAuthorResponse] = None
    project_id: Optional[int] = None
    project: Optional[ProjectSummaryResponse] = None
    is_featured: bool = False
    like_count: int = 0
    comment_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BlogListResponse(BaseModel):
    total: int
    blogs: list[BlogListItem]


# ── 项目响应 ──

class ProjectResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    cover_url: Optional[str] = None
    tags: list[str] = []
    bg_color: Optional[str] = None
    link_url: Optional[str] = None
    links: list[ProjectLinkItem] = []
    like_count: int = 0
    liked_by_me: bool = False
    follow_count: int = 0
    followed_by_me: bool = False
    author_id: int
    author: Optional[BlogAuthorResponse] = None
    blog_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("tags", mode="before")
    @classmethod
    def _parse_tags(cls, v):
        if isinstance(v, str):
            return [t.strip() for t in v.split(",") if t.strip()]
        if v is None:
            return []
        return v

    @field_validator("links", mode="before")
    @classmethod
    def _parse_links(cls, v):
        if v is None:
            return []
        return v


class ProjectListResponse(BaseModel):
    total: int
    projects: list[ProjectResponse]


class ProjectDetailResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    cover_url: Optional[str] = None
    tags: list[str] = []
    bg_color: Optional[str] = None
    link_url: Optional[str] = None
    links: list[ProjectLinkItem] = []
    like_count: int = 0
    liked_by_me: bool = False
    follow_count: int = 0
    followed_by_me: bool = False
    author_id: int
    author: Optional[BlogAuthorResponse] = None
    created_at: datetime
    updated_at: datetime
    blogs: list[BlogListItem] = []

    model_config = {"from_attributes": True}

    @field_validator("tags", mode="before")
    @classmethod
    def _parse_tags(cls, v):
        if isinstance(v, str):
            return [t.strip() for t in v.split(",") if t.strip()]
        if v is None:
            return []
        return v

    @field_validator("links", mode="before")
    @classmethod
    def _parse_links(cls, v):
        if v is None:
            return []
        return v


class ProjectFollowToggleResponse(BaseModel):
    followed: bool
    follow_count: int


# ── 点赞 ──

class LikeToggleResponse(BaseModel):
    liked: bool
    like_count: int


class CommentLikeToggleResponse(BaseModel):
    liked: bool
    like_count: int


# ── 评论 ──

class CommentUserResponse(BaseModel):
    id: int
    username: str
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None

    model_config = {"from_attributes": True}


class CommentResponse(BaseModel):
    id: int
    blog_id: Optional[int] = None
    user_id: int
    parent_id: Optional[int] = None
    content: str
    like_count: int = 0
    liked_by_me: bool = False
    reply_count: int = 0
    created_at: datetime
    updated_at: datetime
    user: Optional[CommentUserResponse] = None

    model_config = {"from_attributes": True}


class CommentListResponse(BaseModel):
    total: int
    comments: list[CommentResponse]


class CreateCommentRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000, description="评论内容")
    parent_id: Optional[int] = Field(None, description="父评论 ID（回复时非空）")


# ── 通知 ──

class MarkNotificationsReadRequest(BaseModel):
    ids: Optional[list[int]] = Field(None, description="要标记已读的通知 ID 列表，缺省则全部已读")


class NotificationResponse(BaseModel):
    id: int
    type: str
    content: str
    is_read: bool
    blog_id: Optional[int] = None
    comment_id: Optional[int] = None
    actor_id: int
    actor_username: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    total: int
    unread_count: int
    notifications: list[NotificationResponse]


# ── 管理员 ──

class AdminUserResponse(BaseModel):
    """管理员视角的用户信息（含角色）"""
    id: int
    username: str
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminUserListResponse(BaseModel):
    total: int
    users: list[AdminUserResponse]


class UpdateUserRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(user|admin)$", description="角色：user/admin")


class UpdateAdminUserRequest(BaseModel):
    nickname: Optional[str] = Field(None, max_length=50, description="昵称")
    avatar_url: Optional[str] = Field(None, max_length=500, description="头像 URL")
    password: Optional[str] = Field(None, min_length=6, max_length=128, description="新密码")


class AdminCommentResponse(BaseModel):
    """管理员视角的评论（含博客标题、用户名与父评论）"""
    id: int
    blog_id: Optional[int] = None
    user_id: int
    content: str
    parent_id: Optional[int] = None
    parent_content: Optional[str] = None
    parent_username: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    user: Optional[CommentUserResponse] = None
    blog_title: Optional[str] = None

    model_config = {"from_attributes": True}


class AdminCommentListResponse(BaseModel):
    total: int
    comments: list[AdminCommentResponse]


class AdminBlogListItem(BaseModel):
    """管理员视角的博客列表项"""
    id: int
    title: str
    category: Optional[str] = None
    author_id: int
    author: Optional[BlogAuthorResponse] = None
    is_featured: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AdminBlogListResponse(BaseModel):
    total: int
    blogs: list[AdminBlogListItem]


class UpdateBlogCategoryRequest(BaseModel):
    category: Optional[str] = Field(None, max_length=50, description="分类：技术讨论/更新日志/娱乐论坛/空")


class UpdateBlogFeaturedRequest(BaseModel):
    is_featured: bool = Field(..., description="是否精选")


class InviteCodeResponse(BaseModel):
    id: int
    code: str
    created_by: int
    owner_user_id: Optional[int] = None
    owner_username: Optional[str] = None
    used_by: Optional[int] = None
    is_used: bool
    is_reusable: bool = False
    created_at: datetime
    used_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class InviteCodeListResponse(BaseModel):
    total: int
    codes: list[InviteCodeResponse]


class CreateInviteCodeResponse(BaseModel):
    code: str
    created_at: datetime


class UpdateInviteCodeReusableRequest(BaseModel):
    is_reusable: bool = Field(..., description="是否可重复使用")


# ── 友情链接 ──

class FriendLinkRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="站点名称")
    url: str = Field(..., min_length=1, max_length=500, description="链接地址")
    description: Optional[str] = Field(None, max_length=200, description="简介")


class UpdateFriendLinkRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100, description="站点名称")
    url: Optional[str] = Field(None, min_length=1, max_length=500, description="链接地址")
    description: Optional[str] = Field(None, max_length=200, description="简介")


class FriendLinkResponse(BaseModel):
    id: int
    name: str
    url: str
    description: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FriendLinkListResponse(BaseModel):
    total: int
    links: list[FriendLinkResponse]


# ── 站点设置 ──

class ContactItem(BaseModel):
    """自定义联系项（与邮箱/GitHub 并列展示在首页"保持联系"）"""
    label: str = Field(..., min_length=1, max_length=50, description="显示名称，如 合作邮箱 / 知乎")
    value: str = Field(..., min_length=1, max_length=500, description="链接或文本")
    type: Optional[str] = Field('link', description="link 链接 / text 文本介绍")
    icon: Optional[str] = Field('', description="内置图标名或图床 URL，可空")
    description: Optional[str] = Field('', max_length=200, description="卡片简介")


class SiteSettingResponse(BaseModel):
    email: str
    github_url: str
    contact_items: list[ContactItem] = []

    model_config = {"from_attributes": True}


class UpdateSiteSettingRequest(BaseModel):
    email: Optional[str] = Field(None, max_length=200, description="联系邮箱")
    github_url: Optional[str] = Field(None, max_length=500, description="GitHub 链接")
    contact_items: Optional[list[ContactItem]] = Field(None, description="自定义联系项（与邮箱/GitHub 并列）")


# ── LeetCode ──

class UpdateLeetcodeRequest(BaseModel):
    leetcode_username: str = Field(..., min_length=1, max_length=100, description="LeetCode 用户名（leetcode.cn）")


class UpdateLeetcodeModeRequest(BaseModel):
    difficulty_mode: Optional[bool] = Field(None, description="是否开启困难模式（得分减半）")
    serious_mode: Optional[bool] = Field(None, description="是否开启严肃模式（简单题不计分）")


class LeetcodeProgress(BaseModel):
    easy: int = 0
    medium: int = 0
    hard: int = 0


class LeetcodeMeResponse(BaseModel):
    bound: bool = False
    leetcode_username: Optional[str] = None
    difficulty_mode: bool = False
    serious_mode: bool = False
    base: LeetcodeProgress = Field(default_factory=LeetcodeProgress)
    cur: LeetcodeProgress = Field(default_factory=LeetcodeProgress)
    inc: LeetcodeProgress = Field(default_factory=LeetcodeProgress)
    total_inc: int = 0
    score: float = 0
    updated_at: Optional[datetime] = None
    leetcode_ok: bool = False


class LeetcodeBoardUser(BaseModel):
    user_id: int
    nickname: Optional[str] = None
    username: str
    avatar_url: Optional[str] = None
    leetcode_username: str
    difficulty_mode: bool
    serious_mode: bool = False
    easy: int
    medium: int
    hard: int
    total: int
    score: float
    updated_at: datetime


class LeetcodeBoardResponse(BaseModel):
    users: list[LeetcodeBoardUser] = []
    generated_at: datetime


class LeetcodeRefreshResponse(BaseModel):
    synced: int = 0
    total: int = 0
