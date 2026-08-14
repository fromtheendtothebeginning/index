# models.py — SQLAlchemy 数据模型

from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint, JSON
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True, comment="用户名")
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
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    is_featured = Column(Boolean, default=False, nullable=False, server_default="0", comment="是否精选")
    content_md = Column(Text, nullable=False, comment="Markdown 内容")
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="发布时间")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    author = relationship("User", backref=backref("blogs", passive_deletes=True))
    project = relationship("Project", back_populates="blogs")
    likes = relationship("BlogLike", backref="blog", cascade="all, delete-orphan")
    comments = relationship("Comment", backref="blog", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Blog(id={self.id}, title='{self.title}')>"


class Project(Base):
    """项目 —— 用于聚合多篇博客"""

    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(200), nullable=False, comment="项目名")
    description = Column(Text, nullable=True, comment="项目简介")
    cover_url = Column(String(500), nullable=True, comment="封面图床 URL")
    tags = Column(Text, nullable=True, comment="标签，逗号分隔")
    bg_color = Column(String(9), nullable=True, comment="自定义封面背景色，如 #6c5ce7")
    link_url = Column(String(500), nullable=True, comment="项目链接（GitHub/下载，可自定义）")
    links = Column(JSON, nullable=True, comment="多个项目链接 [{name,url}]")
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    author = relationship("User", backref=backref("projects", passive_deletes=True))
    blogs = relationship("Blog", back_populates="project")

    def __repr__(self):
        return f"<Project(id={self.id}, name='{self.name}')>"


class BlogLike(Base):
    """博客点赞记录 —— 同一用户对同一篇博客只能点赞一次"""
    __tablename__ = "blog_likes"
    __table_args__ = (UniqueConstraint("blog_id", "user_id", name="uq_blog_user_like"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    blog_id = Column(Integer, ForeignKey("blogs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="点赞时间")


class ProjectLike(Base):
    """项目点赞记录 —— 同一用户对同一项目只能点赞一次"""
    __tablename__ = "project_likes"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_user_like"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="点赞时间")

    user = relationship("User")


class ProjectFollow(Base):
    """项目关注记录 —— 同一用户对同一项目只能关注一次"""
    __tablename__ = "project_follows"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_user_follow"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="关注时间")

    user = relationship("User")

    def __repr__(self):
        return f"<ProjectFollow(id={self.id}, project_id={self.project_id}, user_id={self.user_id})>"


class Comment(Base):
    """博客评论"""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    blog_id = Column(Integer, ForeignKey("blogs.id", ondelete="CASCADE"), nullable=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True, comment="所属项目 ID（项目评论时非空，与 blog_id 二选一）")
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, index=True, comment="父评论 ID（回复时非空）")
    content = Column(Text, nullable=False, comment="评论内容")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="评论时间")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    user = relationship("User")
    parent = relationship("Comment", remote_side="Comment.id", backref="replies")

    def __repr__(self):
        return f"<Comment(id={self.id}, blog_id={self.blog_id})>"


class CommentLike(Base):
    """评论点赞记录 —— 同一用户对同一评论只能点赞一次"""
    __tablename__ = "comment_likes"
    __table_args__ = (UniqueConstraint("comment_id", "user_id", name="uq_comment_user_like"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    comment_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="点赞时间")

    user = relationship("User")


class Notification(Base):
    """站内通知 —— 评论回复 / 评论点赞"""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True, comment="接收者 ID")
    type = Column(String(30), nullable=False, comment="类型：comment_reply / comment_like / blog_comment_like")
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, comment="触发者 ID")
    blog_id = Column(Integer, ForeignKey("blogs.id", ondelete="CASCADE"), nullable=True, comment="相关博客 ID")
    comment_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, comment="相关评论 ID")
    content = Column(String(300), nullable=False, comment="通知文案快照")
    is_read = Column(Boolean, default=False, nullable=False, comment="是否已读")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="通知时间")

    actor = relationship("User", foreign_keys=[actor_id])
    recipient = relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<Notification(id={self.id}, user_id={self.user_id}, type='{self.type}', read={self.is_read})>"


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

    def __repr__(self):
        return f"<InviteCode(id={self.id}, code='{self.code}', used={self.is_used}, reusable={self.is_reusable})>"


class LeetcodeBinding(Base):
    """LeetCode 绑定 —— 记录用户 LeetCode 刷题增量（8.13 起算）"""
    __tablename__ = "leetcode_bindings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True, comment="绑定用户 ID")
    leetcode_username = Column(String(100), unique=True, nullable=False, index=True, comment="LeetCode 用户名（leetcode.cn）")
    difficulty_mode = Column(Boolean, default=False, nullable=False, comment="困难模式：得分减半")
    serious_mode = Column(Boolean, default=False, nullable=False, server_default="0", comment="严肃模式：简单题不计分")
    boost_mode = Column(Boolean, default=False, nullable=False, server_default="0", comment="激励模式：初始 -100 分，3/6/9 计分，与困难/严肃互斥")
    backup_base_easy = Column(Integer, nullable=True, comment="激励模式备份：进入时保存基线，退出时恢复")
    backup_base_medium = Column(Integer, nullable=True, comment="激励模式备份：进入时保存基线，退出时恢复")
    backup_base_hard = Column(Integer, nullable=True, comment="激励模式备份：进入时保存基线，退出时恢复")
    debug_mode = Column(Boolean, default=False, nullable=False, server_default="0", comment="调试模式：不读取 LeetCode，手动调整刷题量")
    debug_backup_base_easy = Column(Integer, nullable=True, comment="调试备份：开启时保存基线，关闭时恢复")
    debug_backup_base_medium = Column(Integer, nullable=True, comment="调试备份：开启时保存基线，关闭时恢复")
    debug_backup_base_hard = Column(Integer, nullable=True, comment="调试备份：开启时保存基线，关闭时恢复")
    debug_backup_cur_easy = Column(Integer, nullable=True, comment="调试备份：开启时保存当前值，关闭时恢复")
    debug_backup_cur_medium = Column(Integer, nullable=True, comment="调试备份：开启时保存当前值，关闭时恢复")
    debug_backup_cur_hard = Column(Integer, nullable=True, comment="调试备份：开启时保存当前值，关闭时恢复")
    base_easy = Column(Integer, default=0, nullable=False, comment="8.13 基线：简单题数")
    base_medium = Column(Integer, default=0, nullable=False, comment="8.13 基线：中等题数")
    base_hard = Column(Integer, default=0, nullable=False, comment="8.13 基线：困难题数")
    cur_easy = Column(Integer, default=0, nullable=False, comment="最近同步：简单题数")
    cur_medium = Column(Integer, default=0, nullable=False, comment="最近同步：中等题数")
    cur_hard = Column(Integer, default=0, nullable=False, comment="最近同步：困难题数")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")

    user = relationship("User")

    def __repr__(self):
        return f"<LeetcodeBinding(id={self.id}, user_id={self.user_id}, leetcode_username='{self.leetcode_username}')>"


class FriendLink(Base):
    """友情链接"""
    __tablename__ = "friend_links"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False, comment="站点名称")
    url = Column(String(500), nullable=False, comment="链接地址")
    description = Column(String(200), nullable=True, comment="简介")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")

    def __repr__(self):
        return f"<FriendLink(id={self.id}, name='{self.name}')>"


class SiteSetting(Base):
    """站点设置（单行配置：首页"保持联系"区块）"""
    __tablename__ = "site_settings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    email = Column(String(200), nullable=False, default="", comment="联系邮箱")
    github_url = Column(String(500), nullable=False, default="", comment="GitHub 链接")
    contact_items = Column(JSON, nullable=True, comment="自定义联系项 [{label,value}]，与邮箱/GitHub 并列")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    def __repr__(self):
        return f"<SiteSetting(id={self.id}, email='{self.email}')>"
