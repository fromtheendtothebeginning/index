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

class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="项目名")
    description: Optional[str] = Field(None, max_length=65535, description="项目简介")
    cover_url: Optional[str] = Field(None, max_length=500, description="封面图床 URL")
    tags: Optional[list[str]] = Field(None, description="项目标签列表")
    bg_color: Optional[str] = Field(None, max_length=9, description="自定义封面背景色，如 #6c5ce7")
    link_url: Optional[str] = Field(None, max_length=500, description="项目链接（GitHub/下载，可自定义）")


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200, description="项目名")
    description: Optional[str] = Field(None, max_length=65535, description="项目简介")
    cover_url: Optional[str] = Field(None, max_length=500, description="封面图床 URL")
    tags: Optional[list[str]] = Field(None, description="项目标签列表")
    bg_color: Optional[str] = Field(None, max_length=9, description="自定义封面背景色，如 #6c5ce7")
    link_url: Optional[str] = Field(None, max_length=500, description="项目链接（GitHub/下载，可自定义）")


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


# ── 点赞 ──

class LikeToggleResponse(BaseModel):
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
    blog_id: int
    user_id: int
    content: str
    created_at: datetime
    updated_at: datetime
    user: Optional[CommentUserResponse] = None

    model_config = {"from_attributes": True}


class CommentListResponse(BaseModel):
    total: int
    comments: list[CommentResponse]


class CreateCommentRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000, description="评论内容")


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


class AdminCommentResponse(BaseModel):
    """管理员视角的评论（含博客标题和用户名）"""
    id: int
    blog_id: int
    user_id: int
    content: str
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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AdminBlogListResponse(BaseModel):
    total: int
    blogs: list[AdminBlogListItem]


class UpdateBlogCategoryRequest(BaseModel):
    category: Optional[str] = Field(None, max_length=50, description="分类：技术讨论/更新日志/娱乐论坛/空")


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
