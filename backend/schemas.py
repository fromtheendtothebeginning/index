# schemas.py — Pydantic 请求/响应模型

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


# ── 请求 ──

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, description="用户名")
    password: str = Field(..., min_length=6, max_length=128, description="密码")


class LoginRequest(BaseModel):
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")


class ResetPasswordRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, description="用户名")
    new_password: str = Field(..., min_length=6, max_length=128, description="新密码")


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


class UpdateBlogRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200, description="文章标题")
    category: Optional[str] = Field(None, max_length=50, description="分类：技术讨论 / 更新日志 / 娱乐论坛")
    content_md: Optional[str] = Field(None, min_length=1, max_length=65535, description="Markdown 内容")


# ── 博客响应 ──

class BlogAuthorResponse(BaseModel):
    id: int
    username: str
    nickname: Optional[str] = None

    model_config = {"from_attributes": True}


class BlogResponse(BaseModel):
    id: int
    title: str
    category: Optional[str] = None
    content_md: str
    author_id: int
    author: Optional[BlogAuthorResponse] = None
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
    like_count: int = 0
    comment_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BlogListResponse(BaseModel):
    total: int
    blogs: list[BlogListItem]


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
