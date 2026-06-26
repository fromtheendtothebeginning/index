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
