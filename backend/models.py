# models.py — SQLAlchemy 数据模型

from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True, comment="用户名")
    email = Column(String(120), unique=True, nullable=True, comment="邮箱")
    hashed_password = Column(String(255), nullable=False, comment="加密后的密码")
    nickname = Column(String(50), nullable=True, comment="昵称")
    avatar_url = Column(String(500), nullable=True, comment="头像 URL")
    is_active = Column(Boolean, default=True, comment="是否激活")
    # 角色：user 普通用户 / admin 管理员（不对外公开，仅后台管理）
    role = Column(String(20), nullable=False, default="user", server_default="user", comment="角色：user/admin")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="注册时间")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    def __repr__(self):
        return f"<User(id={self.id}, username='{self.username}')>"


class Blog(Base):
    __tablename__ = "blogs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    title = Column(String(200), nullable=False, comment="文章标题")
    category = Column(String(50), nullable=True, comment="分类：技术讨论 / 更新日志 / 娱乐论坛")
    content_md = Column(Text, nullable=False, comment="Markdown 内容")
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="发布时间")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    author = relationship("User", backref="blogs")
    likes = relationship("BlogLike", backref="blog", cascade="all, delete-orphan")
    comments = relationship("Comment", backref="blog", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Blog(id={self.id}, title='{self.title}')>"


class BlogLike(Base):
    """博客点赞记录 —— 同一用户对同一篇博客只能点赞一次"""
    __tablename__ = "blog_likes"
    __table_args__ = (UniqueConstraint("blog_id", "user_id", name="uq_blog_user_like"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    blog_id = Column(Integer, ForeignKey("blogs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="点赞时间")

    user = relationship("User")


class Comment(Base):
    """博客评论"""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    blog_id = Column(Integer, ForeignKey("blogs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False, comment="评论内容")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="评论时间")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    user = relationship("User")

    def __repr__(self):
        return f"<Comment(id={self.id}, blog_id={self.blog_id})>"


class InviteCode(Base):
    """邀请码 —— 管理员生成或用户专属，默认一次性使用"""
    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    code = Column(String(64), unique=True, nullable=False, index=True, comment="邀请码")
    created_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, comment="生成者ID")
    # 专属用户：非 NULL 表示这是该用户的专属邀请码（注册时自动分配）
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, comment="专属用户ID")
    used_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, comment="使用者ID")
    is_used = Column(Boolean, default=False, nullable=False, comment="是否已使用")
    is_reusable = Column(Boolean, default=False, nullable=False, server_default="0", comment="是否可重复使用")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="生成时间")
    used_at = Column(DateTime(timezone=True), nullable=True, comment="使用时间")

    creator = relationship("User", foreign_keys=[created_by])
    owner = relationship("User", foreign_keys=[owner_user_id])
    used_user = relationship("User", foreign_keys=[used_by])

    def __repr__(self):
        return f"<InviteCode(id={self.id}, code='{self.code}', used={self.is_used}, reusable={self.is_reusable})>"
