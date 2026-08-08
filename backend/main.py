# main.py — FastAPI 应用入口

import secrets
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

from database import get_db, init_db, run_migrations
from models import User, Blog, BlogLike, Comment, CommentLike, Notification, InviteCode, Project, FriendLink, ProjectLike, ProjectFollow
from schemas import (
    RegisterRequest, LoginRequest, ResetPasswordRequest, UpdateProfileRequest,
    CreateBlogRequest, UpdateBlogRequest, TokenResponse, UserResponse,
    BlogResponse, BlogListItem, BlogListResponse, MessageResponse,
    LikeToggleResponse, CommentLikeToggleResponse, CommentResponse, CommentListResponse,
    CreateCommentRequest, NotificationResponse, NotificationListResponse, MarkNotificationsReadRequest,
    AdminUserResponse, AdminUserListResponse, UpdateUserRoleRequest,
    AdminCommentResponse, AdminCommentListResponse,
    AdminBlogListItem, AdminBlogListResponse, UpdateBlogCategoryRequest,
    InviteCodeResponse, InviteCodeListResponse, CreateInviteCodeResponse,
    UpdateInviteCodeReusableRequest,
    CreateProjectRequest, UpdateProjectRequest, ProjectResponse,
    ProjectListResponse, ProjectDetailResponse, UpdateProjectBlogsRequest,
    ProjectLinkItem, ProjectFollowToggleResponse,
    FriendLinkRequest, FriendLinkResponse, FriendLinkListResponse,
    UpdateFriendLinkRequest,
)
from auth import hash_password, verify_password, create_access_token, decode_access_token

# ============================================
# 应用初始化
# ============================================

app = FastAPI(title="anticraft API", version="1.0.0")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")
# 可选鉴权 —— 未携带 token 时不报错，返回 None（用于公开接口附带当前用户信息）
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/login", auto_error=False)

# CORS —— 允许前端开发服务器跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    """首次启动自动建表 + 迁移新字段"""
    init_db()
    run_migrations()


# ============================================
# API 路由
# ============================================

@app.get("/api/health", tags=["系统"])
def health_check():
    """健康检查"""
    return {"status": "ok", "message": "anticraft API is running"}


@app.post("/api/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, tags=["认证"])
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """用户注册（需邀请码）"""

    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="用户名已被注册",
        )

    # 校验邀请码
    invite = db.query(InviteCode).filter(InviteCode.code == req.invite_code).first()
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码无效",
        )
    if invite.is_used and not invite.is_reusable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码已被使用",
        )

    user = User(
        username=req.username,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # 标记邀请码已使用（可重复使用的邀请码也标记，但不阻止再次使用）
    from datetime import datetime, timezone
    invite.is_used = True
    invite.used_by = user.id
    invite.used_at = datetime.now(timezone.utc)
    db.commit()

    # 为新用户自动生成专属邀请码（可重复使用）
    user_code = secrets.token_urlsafe(8).upper().replace("-", "").replace("_", "")[:12]
    user_invite = InviteCode(
        code=user_code,
        created_by=user.id,
        owner_user_id=user.id,
        is_reusable=True,
    )
    db.add(user_invite)
    db.commit()

    token = create_access_token({"sub": str(user.id), "username": user.username})

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@app.post("/api/login", response_model=TokenResponse, tags=["认证"])
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """用户登录"""

    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    token = create_access_token({"sub": str(user.id), "username": user.username})

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@app.get("/api/user/me", response_model=UserResponse, tags=["用户"])
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """获取当前登录用户信息（需 Bearer Token）"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")

    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    return UserResponse.model_validate(user)


@app.put("/api/user/profile", response_model=UserResponse, tags=["用户"])
def update_profile(
    req: UpdateProfileRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """更新当前用户昵称和头像"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")

    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    if req.nickname is not None:
        user.nickname = req.nickname
    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url

    db.commit()
    db.refresh(user)

    return UserResponse.model_validate(user)


@app.get("/api/user/check-username", tags=["用户"])
def check_username(username: str, db: Session = Depends(get_db)):
    """检查用户名是否存在"""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return {"exists": True, "username": user.username}


@app.put("/api/user/reset-password", response_model=MessageResponse, tags=["用户"])
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """重置密码（无需登录，需邀请码验证）"""
    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在",
        )

    # 校验邀请码（改密码时只需有效邀请码，不消耗）
    invite = db.query(InviteCode).filter(InviteCode.code == req.invite_code).first()
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码无效",
        )
    if invite.is_used and not invite.is_reusable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码已被使用",
        )

    user.hashed_password = hash_password(req.new_password)
    db.commit()

    return MessageResponse(message="密码重置成功")


# ============================================
# 博客 API
# ============================================

def get_current_user_obj(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """获取当前用户对象"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return user


def require_admin(current_user: User = Depends(get_current_user_obj)) -> User:
    """管理员权限依赖 —— 非管理员返回 403"""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


def get_optional_user(token: Optional[str], db: Session) -> Optional[User]:
    """可选鉴权：传入 Bearer token 时返回用户，否则返回 None"""
    if not token:
        return None
    payload = decode_access_token(token)
    if payload is None:
        return None
    user_id = payload.get("sub")
    if user_id is None:
        return None
    return db.query(User).filter(User.id == int(user_id)).first()


def _attach_blog_stats(blog: Blog, db: Session, current_user: Optional[User]) -> None:
    """为博客对象附加点赞数、评论数、当前用户是否点赞"""
    blog.like_count = db.query(BlogLike).filter(BlogLike.blog_id == blog.id).count()
    blog.comment_count = db.query(Comment).filter(Comment.blog_id == blog.id).count()
    if current_user:
        blog.liked_by_me = (
            db.query(BlogLike)
            .filter(BlogLike.blog_id == blog.id, BlogLike.user_id == current_user.id)
            .first()
            is not None
        )
    else:
        blog.liked_by_me = False


def _attach_project_stats(project: Project, db: Session, current_user: Optional[User]) -> None:
    """为项目对象附加点赞数、关注数、当前用户是否点赞/关注"""
    project.like_count = db.query(ProjectLike).filter(ProjectLike.project_id == project.id).count()
    project.follow_count = db.query(ProjectFollow).filter(ProjectFollow.project_id == project.id).count()
    project.liked_by_me = current_user is not None and db.query(ProjectLike).filter(ProjectLike.project_id == project.id, ProjectLike.user_id == current_user.id).first() is not None
    project.followed_by_me = current_user is not None and db.query(ProjectFollow).filter(ProjectFollow.project_id == project.id, ProjectFollow.user_id == current_user.id).first() is not None


@app.get("/api/blogs", response_model=BlogListResponse, tags=["博客"])
def list_blogs(
    skip: int = 0,
    limit: int = 20,
    category: Optional[str] = None,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """获取博客列表（按更新时间倒序，可按分类筛选）"""
    current_user = get_optional_user(token, db)
    query = db.query(Blog)
    if category:
        query = query.filter(Blog.category == category)
    total = query.count()
    blogs = (
        query
        .options(joinedload(Blog.author), joinedload(Blog.project))
        .order_by(Blog.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    for b in blogs:
        _attach_blog_stats(b, db, current_user)
    return BlogListResponse(total=total, blogs=blogs)


@app.get("/api/blogs/{blog_id}", response_model=BlogResponse, tags=["博客"])
def get_blog(
    blog_id: int,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """获取单篇博客详情"""
    blog = db.query(Blog).options(joinedload(Blog.author), joinedload(Blog.project)).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")
    current_user = get_optional_user(token, db)
    _attach_blog_stats(blog, db, current_user)
    return blog


@app.post("/api/blogs", response_model=BlogResponse, status_code=status.HTTP_201_CREATED, tags=["博客"])
def create_blog(
    req: CreateBlogRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """创建博客文章（需登录）"""
    if req.project_id is not None:
        project = db.query(Project).filter(Project.id == req.project_id).first()
        if not project:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目不存在")
    blog = Blog(
        title=req.title,
        category=req.category,
        content_md=req.content_md,
        author_id=current_user.id,
        project_id=req.project_id,
    )
    db.add(blog)
    db.commit()
    db.refresh(blog)
    # 重新查询以加载 author / project 关系
    blog = db.query(Blog).options(joinedload(Blog.author), joinedload(Blog.project)).filter(Blog.id == blog.id).first()
    _attach_blog_stats(blog, db, current_user)
    return blog


@app.put("/api/blogs/{blog_id}", response_model=BlogResponse, tags=["博客"])
def update_blog(
    blog_id: int,
    req: UpdateBlogRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """更新博客文章（作者或管理员）"""
    blog = db.query(Blog).options(joinedload(Blog.author), joinedload(Blog.project)).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")
    is_owner = blog.author_id == current_user.id
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改他人博客")

    if req.title is not None:
        blog.title = req.title
    if req.category is not None:
        blog.category = req.category
    if req.content_md is not None:
        blog.content_md = req.content_md
    if "project_id" in req.model_fields_set:
        if req.project_id is not None:
            project = db.query(Project).filter(Project.id == req.project_id).first()
            if not project:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目不存在")
        blog.project_id = req.project_id

    db.commit()
    db.refresh(blog)
    _attach_blog_stats(blog, db, current_user)
    return blog


@app.delete("/api/blogs/{blog_id}", response_model=MessageResponse, tags=["博客"])
def delete_blog(
    blog_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """删除博客文章（作者或管理员可撤回）"""
    blog = db.query(Blog).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")
    is_owner = blog.author_id == current_user.id
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人博客")

    db.delete(blog)
    db.commit()
    return MessageResponse(message="博客已删除")


# ============================================
# 项目 API
# ============================================

@app.get("/api/projects", response_model=ProjectListResponse, tags=["项目"])
def list_projects(
    skip: int = 0,
    limit: int = 50,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """获取项目列表（按创建时间倒序，附带每个项目的博客数）"""
    current_user = get_optional_user(token, db)
    total = db.query(Project).count()
    projects = (
        db.query(Project)
        .options(joinedload(Project.author))
        .order_by(Project.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    for p in projects:
        p.blog_count = db.query(Blog).filter(Blog.project_id == p.id).count()
        _attach_project_stats(p, db, current_user)
    return ProjectListResponse(total=total, projects=projects)


@app.get("/api/projects/{project_id}", response_model=ProjectDetailResponse, tags=["项目"])
def get_project(
    project_id: int,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """获取项目详情（含项目下的博客列表，按发布时间从新到旧）"""
    project = (
        db.query(Project)
        .options(joinedload(Project.author))
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    current_user = get_optional_user(token, db)
    blogs = (
        db.query(Blog)
        .options(joinedload(Blog.author), joinedload(Blog.project))
        .filter(Blog.project_id == project_id)
        .order_by(Blog.created_at.desc())
        .all()
    )
    for b in blogs:
        _attach_blog_stats(b, db, current_user)
    project.blogs = blogs
    _attach_project_stats(project, db, current_user)
    return project


@app.post("/api/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED, tags=["项目"])
def create_project(
    req: CreateProjectRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """创建项目（仅管理员）"""
    project = Project(
        name=req.name,
        description=req.description,
        cover_url=req.cover_url,
        author_id=current_user.id,
    )
    if req.tags is not None:
        project.tags = ",".join(t.strip() for t in req.tags if t.strip())
    if req.bg_color is not None:
        project.bg_color = req.bg_color or None
    if req.link_url is not None:
        project.link_url = req.link_url or None
    if req.links is not None:
        project.links = [l.model_dump() for l in req.links]
    db.add(project)
    db.commit()
    db.refresh(project)
    # 重新查询以加载 author 关系
    project = (
        db.query(Project)
        .options(joinedload(Project.author))
        .filter(Project.id == project.id)
        .first()
    )
    project.blog_count = 0
    return project


@app.put("/api/projects/{project_id}", response_model=ProjectResponse, tags=["项目"])
def update_project(
    project_id: int,
    req: UpdateProjectRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """更新项目（仅作者或管理员）"""
    project = (
        db.query(Project)
        .options(joinedload(Project.author))
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    is_owner = project.author_id == current_user.id
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改他人项目")

    for field in ("name", "description", "cover_url"):
        value = getattr(req, field)
        if value is not None:
            setattr(project, field, value)
    if "bg_color" in req.model_fields_set:
        project.bg_color = req.bg_color or None
    if "link_url" in req.model_fields_set:
        project.link_url = req.link_url or None
    if "links" in req.model_fields_set:
        project.links = [l.model_dump() for l in req.links] if req.links is not None else None
    if req.tags is not None:
        project.tags = ",".join(t.strip() for t in req.tags if t.strip())

    db.commit()
    db.refresh(project)
    project.blog_count = db.query(Blog).filter(Blog.project_id == project.id).count()
    return project


@app.put("/api/projects/{project_id}/blogs", response_model=ProjectDetailResponse, tags=["项目"])
def update_project_blogs(
    project_id: int,
    req: UpdateProjectBlogsRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """项目编辑界面批量设置关联博客（全量替换，作者或管理员）"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    is_owner = project.author_id == current_user.id
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改他人项目")

    wanted = set(req.blog_ids)
    if len(wanted) != len(req.blog_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="博客 ID 列表包含重复项")
    if wanted:
        existing = {b[0] for b in db.query(Blog.id).filter(Blog.id.in_(wanted)).all()}
        if existing != wanted:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="包含不存在的博客")

    # 找出本次将新关联到本项目的博客（原 project_id 不是本项目），用于通知关注者
    # 注意：NULL 用 is_(None) 单独匹配，`!=` 不会命中 NULL 行
    old_blog_ids = set()
    if wanted:
        old_blog_ids = {
            b[0] for b in db.query(Blog.id)
            .filter(
                Blog.id.in_(wanted),
                or_(Blog.project_id != project_id, Blog.project_id.is_(None)),
            )
            .all()
        }

    # 解除本项目中不在列表内的博客
    q = db.query(Blog).filter(Blog.project_id == project_id)
    if wanted:
        q = q.filter(~Blog.id.in_(wanted))
    q.update({"project_id": None}, synchronize_session=False)
    # 将列表中的博客关联到本项目
    if wanted:
        db.query(Blog).filter(Blog.id.in_(wanted)).update(
            {"project_id": project_id}, synchronize_session=False
        )
    db.commit()

    # 关联了新博客时，通知所有关注者（作者本人除外）
    if old_blog_ids:
        followers = db.query(ProjectFollow.user_id).filter(ProjectFollow.project_id == project_id).all()
        new_blogs = {b.id: b.title for b in db.query(Blog).filter(Blog.id.in_(old_blog_ids)).all()}
        for fid, in followers:
            if fid == project.author_id:
                continue
            for bid, btitle in new_blogs.items():
                _notify(
                    db, fid, "project_new_blog", project.author_id, bid, None,
                    f"项目「{project.name}」关联了新博客《{btitle}》",
                )

    project = (
        db.query(Project)
        .options(joinedload(Project.author))
        .filter(Project.id == project_id)
        .first()
    )
    blogs = (
        db.query(Blog)
        .options(joinedload(Blog.author), joinedload(Blog.project))
        .filter(Blog.project_id == project_id)
        .order_by(Blog.created_at.desc())
        .all()
    )
    for b in blogs:
        _attach_blog_stats(b, db, None)
    project.blogs = blogs
    _attach_project_stats(project, db, None)
    return project


@app.delete("/api/projects/{project_id}", response_model=MessageResponse, tags=["项目"])
def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """删除项目（仅作者或管理员，项目下博客的 project_id 由数据库置空）"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    is_owner = project.author_id == current_user.id
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人项目")

    db.delete(project)
    db.commit()
    return MessageResponse(message="项目已删除")


@app.post("/api/projects/{project_id}/follow", response_model=ProjectFollowToggleResponse, tags=["项目"])
def toggle_project_follow(
    project_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """切换项目关注状态（已关注则取消，未关注则关注）"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    existing = (
        db.query(ProjectFollow)
        .filter(ProjectFollow.project_id == project_id, ProjectFollow.user_id == current_user.id)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        followed = False
    else:
        db.add(ProjectFollow(project_id=project_id, user_id=current_user.id))
        db.commit()
        followed = True

    follow_count = db.query(ProjectFollow).filter(ProjectFollow.project_id == project_id).count()
    return ProjectFollowToggleResponse(followed=followed, follow_count=follow_count)


# ============================================
# 点赞 API
# ============================================

def _notify(db, user_id, type_, actor_id, blog_id, comment_id, content):
    """发站内通知并去重：同接收者/类型/触发者/目标的未读通知已存在则不再发。"""
    dup = (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.type == type_,
            Notification.actor_id == actor_id,
            Notification.comment_id == comment_id,
            Notification.blog_id == blog_id,
            Notification.is_read.is_(False),
        )
        .first()
    )
    if dup:
        return
    db.add(Notification(
        user_id=user_id,
        type=type_,
        actor_id=actor_id,
        blog_id=blog_id,
        comment_id=comment_id,
        content=content,
    ))
    db.commit()


@app.post("/api/blogs/{blog_id}/like", response_model=LikeToggleResponse, tags=["点赞"])
def toggle_like(
    blog_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """切换点赞状态（已点赞则取消，未点赞则点赞）"""
    blog = db.query(Blog).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")

    existing = (
        db.query(BlogLike)
        .filter(BlogLike.blog_id == blog_id, BlogLike.user_id == current_user.id)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        liked = False
    else:
        db.add(BlogLike(blog_id=blog_id, user_id=current_user.id))
        db.commit()
        liked = True
        # 博客被点赞：通知博客作者（自己赞自己的博客不通知）
        if blog.author_id != current_user.id:
            _notify(
                db, blog.author_id, "blog_like", current_user.id,
                blog.id, None, f"「{current_user.username}」赞了你的博客《{blog.title}》",
            )

    like_count = db.query(BlogLike).filter(BlogLike.blog_id == blog_id).count()
    return LikeToggleResponse(liked=liked, like_count=like_count)


@app.post("/api/projects/{project_id}/like", response_model=LikeToggleResponse, tags=["点赞"])
def toggle_project_like(
    project_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """切换项目点赞状态（已点赞则取消，未点赞则点赞）"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    existing = (
        db.query(ProjectLike)
        .filter(ProjectLike.project_id == project_id, ProjectLike.user_id == current_user.id)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        liked = False
    else:
        db.add(ProjectLike(project_id=project_id, user_id=current_user.id))
        db.commit()
        liked = True

    like_count = db.query(ProjectLike).filter(ProjectLike.project_id == project_id).count()
    return LikeToggleResponse(liked=liked, like_count=like_count)


@app.post("/api/comments/{comment_id}/like", response_model=CommentLikeToggleResponse, tags=["点赞"])
def toggle_comment_like(
    comment_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """切换评论点赞状态（已点赞则取消，未点赞则点赞）"""
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")

    existing = (
        db.query(CommentLike)
        .filter(CommentLike.comment_id == comment_id, CommentLike.user_id == current_user.id)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        liked = False
    else:
        db.add(CommentLike(comment_id=comment_id, user_id=current_user.id))
        db.commit()
        liked = True
        # 首次点赞才发通知（_notify 内部去重）
        blog = db.query(Blog).filter(Blog.id == comment.blog_id).first()
        # a) 通知评论作者（自己赞自己的评论不通知）
        if comment.user_id != current_user.id:
            _notify(
                db, comment.user_id, "comment_like", current_user.id,
                comment.blog_id, comment.id, f"「{current_user.username}」赞了你的评论",
            )
        # b) 博客作者与评论作者不是同一人且非当前用户时，通知博客作者
        if blog and blog.author_id != comment.user_id and blog.author_id != current_user.id:
            _notify(
                db, blog.author_id, "blog_comment_like", current_user.id,
                comment.blog_id, comment.id, f"「{current_user.username}」赞了你博客下的评论",
            )

    like_count = db.query(CommentLike).filter(CommentLike.comment_id == comment_id).count()
    return CommentLikeToggleResponse(liked=liked, like_count=like_count)


# ============================================
# 评论 API
# ============================================

def _comment_reply_counts(comments):
    """递归统计每条评论的后代回复总数（O(n)，带缓存避免重复遍历），返回 {id: 子树回复数}"""
    children = {}
    for c in comments:
        if c.parent_id is not None:
            children.setdefault(c.parent_id, []).append(c.id)
    reply_counts = {}

    def count_descendants(cid):
        if cid in reply_counts:
            return reply_counts[cid]
        total = 0
        for child_id in children.get(cid, []):
            total += 1 + count_descendants(child_id)
        reply_counts[cid] = total
        return total

    for c in comments:
        c.reply_count = count_descendants(c.id)
    return reply_counts


def _attach_comment_stats(comments, db: Session, current_user: Optional[User]) -> None:
    """为评论列表附加点赞数、当前用户是否点赞、后代回复数（博客/项目评论共用）"""
    comment_ids = [c.id for c in comments]
    like_counts = {}
    if comment_ids:
        for (cid,) in (
            db.query(CommentLike.comment_id)
            .filter(CommentLike.comment_id.in_(comment_ids))
            .all()
        ):
            like_counts[cid] = like_counts.get(cid, 0) + 1
    liked_by_me_ids = set()
    if comment_ids and current_user:
        liked_by_me_ids = {
            cid for (cid,) in (
                db.query(CommentLike.comment_id)
                .filter(CommentLike.comment_id.in_(comment_ids), CommentLike.user_id == current_user.id)
                .all()
            )
        }
    for c in comments:
        c.like_count = like_counts.get(c.id, 0)
        c.liked_by_me = c.id in liked_by_me_ids
    _comment_reply_counts(comments)


@app.get("/api/blogs/{blog_id}/comments", response_model=CommentListResponse, tags=["评论"])
def list_comments(
    blog_id: int,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """获取某篇博客的评论列表（按时间正序，父评论在回复之前）"""
    blog = db.query(Blog).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")

    current_user = get_optional_user(token, db)
    comments = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .filter(Comment.blog_id == blog_id)
        .order_by(Comment.created_at.asc())
        .all()
    )
    _attach_comment_stats(comments, db, current_user)
    return CommentListResponse(total=len(comments), comments=comments)


@app.get("/api/projects/{project_id}/comments", response_model=CommentListResponse, tags=["评论"])
def list_project_comments(
    project_id: int,
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """获取某项目的评论列表（按时间正序，父评论在回复之前）"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    current_user = get_optional_user(token, db)
    comments = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .filter(Comment.project_id == project_id)
        .order_by(Comment.created_at.asc())
        .all()
    )
    _attach_comment_stats(comments, db, current_user)
    return CommentListResponse(total=len(comments), comments=comments)


@app.post("/api/blogs/{blog_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED, tags=["评论"])
def create_comment(
    blog_id: int,
    req: CreateCommentRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """发表评论（需登录，parent_id 非空时为回复）"""
    blog = db.query(Blog).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")

    parent = None
    if req.parent_id is not None:
        parent = db.query(Comment).filter(Comment.id == req.parent_id).first()
        if not parent or parent.blog_id != blog_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="父评论不存在或不属于该博客",
            )

    comment = Comment(
        blog_id=blog_id,
        user_id=current_user.id,
        parent_id=req.parent_id,
        content=req.content,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    # 回复通知：父评论作者（非本人）收到 comment_reply 通知（_notify 内部去重）
    if parent and parent.user_id != current_user.id:
        _notify(
            db, parent.user_id, "comment_reply", current_user.id,
            blog_id, comment.id, f"「{current_user.username}」回复了你的评论",
        )
    # 博客被发表新评论（顶级评论）：通知博客作者（自己评论自己的博客不通知）
    elif req.parent_id is None and blog.author_id != current_user.id:
        _notify(
            db, blog.author_id, "blog_new_comment", current_user.id,
            blog_id, comment.id, f"「{current_user.username}」评论了你的博客《{blog.title}》",
        )

    # 重新查询以加载 user 关系
    comment = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .filter(Comment.id == comment.id)
        .first()
    )
    comment.like_count = 0
    comment.liked_by_me = False
    comment.reply_count = 0
    return comment


@app.post("/api/projects/{project_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED, tags=["评论"])
def create_project_comment(
    project_id: int,
    req: CreateCommentRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """发表项目评论（需登录，parent_id 非空时为回复）"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    parent = None
    if req.parent_id is not None:
        parent = db.query(Comment).filter(Comment.id == req.parent_id).first()
        if not parent or parent.project_id != project_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="父评论不存在或不属于该项目",
            )

    comment = Comment(
        project_id=project_id,
        user_id=current_user.id,
        parent_id=req.parent_id,
        content=req.content,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    # 回复通知：父评论作者（非本人）收到 comment_reply 通知（_notify 内部去重）
    if parent and parent.user_id != current_user.id:
        _notify(
            db, parent.user_id, "comment_reply", current_user.id,
            None, comment.id, f"「{current_user.username}」回复了你的评论",
        )

    # 重新查询以加载 user 关系
    comment = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .filter(Comment.id == comment.id)
        .first()
    )
    comment.like_count = 0
    comment.liked_by_me = False
    comment.reply_count = 0
    return comment


@app.delete("/api/comments/{comment_id}", response_model=MessageResponse, tags=["评论"])
def delete_comment(
    comment_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """删除评论（作者本人或管理员）"""
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")
    is_owner = comment.user_id == current_user.id
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人评论")

    db.delete(comment)
    db.commit()
    return MessageResponse(message="评论已删除")


# ============================================
# 通知 API
# ============================================

@app.get("/api/notifications", response_model=NotificationListResponse, tags=["通知"])
def list_notifications(
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """获取当前用户的通知列表（按时间倒序）"""
    notifications = (
        db.query(Notification)
        .options(joinedload(Notification.actor))
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .all()
    )
    unread_count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read.is_(False))
        .count()
    )
    # 附加 actor_username（不在模型中，动态赋值）
    for n in notifications:
        n.actor_username = n.actor.username if n.actor else None
    return NotificationListResponse(
        total=len(notifications),
        unread_count=unread_count,
        notifications=notifications,
    )


@app.put("/api/notifications/read", response_model=MessageResponse, tags=["通知"])
def mark_notifications_read(
    req: MarkNotificationsReadRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """标记通知已读（ids 缺省则全部已读）"""
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if req.ids:
        query = query.filter(Notification.id.in_(req.ids))
    query.update({"is_read": True}, synchronize_session=False)
    db.commit()
    return MessageResponse(message="已读")


# ============================================
# 管理员 API
# ============================================

@app.get("/api/admin/users", response_model=AdminUserListResponse, tags=["管理员"])
def admin_list_users(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """获取所有用户列表（含角色，仅管理员）"""
    users = db.query(User).order_by(User.created_at.asc()).all()
    return AdminUserListResponse(total=len(users), users=users)


@app.put("/api/admin/users/{user_id}/role", response_model=AdminUserResponse, tags=["管理员"])
def admin_update_user_role(
    user_id: int,
    req: UpdateUserRoleRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """设置用户角色（仅管理员）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能修改自己的角色")
    user.role = req.role
    db.commit()
    db.refresh(user)
    return user


@app.get("/api/admin/comments", response_model=AdminCommentListResponse, tags=["管理员"])
def admin_list_comments(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """获取所有评论（含博客标题，仅管理员）"""
    comments = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .order_by(Comment.created_at.desc())
        .all()
    )
    # 批量查询博客标题
    blog_ids = {c.blog_id for c in comments}
    blog_titles = {}
    if blog_ids:
        blogs = db.query(Blog).filter(Blog.id.in_(blog_ids)).all()
        blog_titles = {b.id: b.title for b in blogs}
    # 批量查询父评论（作者与内容）
    parent_ids = {c.parent_id for c in comments if c.parent_id}
    parents = {}
    if parent_ids:
        p_rows = (
            db.query(Comment, User)
            .join(User, User.id == Comment.user_id)
            .filter(Comment.id.in_(parent_ids))
            .all()
        )
        parents = {c.id: (c, u) for c, u in p_rows}
    for c in comments:
        c.blog_title = blog_titles.get(c.blog_id)
        if c.parent_id and c.parent_id in parents:
            pc, pu = parents[c.parent_id]
            c.parent_content = pc.content
            c.parent_username = pu.nickname or pu.username
    return AdminCommentListResponse(total=len(comments), comments=comments)


@app.delete("/api/admin/comments/{comment_id}", response_model=MessageResponse, tags=["管理员"])
def admin_delete_comment(
    comment_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员删除任意评论"""
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")
    db.delete(comment)
    db.commit()
    return MessageResponse(message="评论已删除")


@app.get("/api/admin/blogs", response_model=AdminBlogListResponse, tags=["管理员"])
def admin_list_blogs(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """获取所有博客（仅管理员）"""
    blogs = (
        db.query(Blog)
        .options(joinedload(Blog.author))
        .order_by(Blog.created_at.desc())
        .all()
    )
    return AdminBlogListResponse(total=len(blogs), blogs=blogs)


@app.delete("/api/admin/blogs/{blog_id}", response_model=MessageResponse, tags=["管理员"])
def admin_delete_blog(
    blog_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员撤回（删除）任意博客"""
    blog = db.query(Blog).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")
    db.delete(blog)
    db.commit()
    return MessageResponse(message="博客已撤回")


@app.put("/api/admin/blogs/{blog_id}/category", response_model=AdminBlogListItem, tags=["管理员"])
def admin_update_blog_category(
    blog_id: int,
    req: UpdateBlogCategoryRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员设置博客分类"""
    blog = db.query(Blog).options(joinedload(Blog.author)).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")
    blog.category = req.category
    db.commit()
    db.refresh(blog)
    # 重新加载 author 关系
    blog = db.query(Blog).options(joinedload(Blog.author)).filter(Blog.id == blog_id).first()
    return blog


@app.post("/api/admin/invite-codes", response_model=CreateInviteCodeResponse, status_code=status.HTTP_201_CREATED, tags=["管理员"])
def admin_create_invite_code(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """生成邀请码（仅管理员，默认一次性使用）"""
    code = secrets.token_urlsafe(8).upper().replace("-", "").replace("_", "")[:12]
    invite = InviteCode(code=code, created_by=admin.id)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return CreateInviteCodeResponse(code=invite.code, created_at=invite.created_at)


@app.get("/api/admin/invite-codes", response_model=InviteCodeListResponse, tags=["管理员"])
def admin_list_invite_codes(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """获取所有邀请码（含专属用户信息，仅管理员）"""
    codes = (
        db.query(InviteCode)
        .options(joinedload(InviteCode.owner), joinedload(InviteCode.creator))
        .order_by(InviteCode.created_at.desc())
        .all()
    )
    # 附加 owner_username（不在模型中，动态赋值）
    for c in codes:
        c.owner_username = c.owner.username if c.owner else None
    return InviteCodeListResponse(total=len(codes), codes=codes)


@app.delete("/api/admin/invite-codes/{code_id}", response_model=MessageResponse, tags=["管理员"])
def admin_delete_invite_code(
    code_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员删除邀请码"""
    invite = db.query(InviteCode).filter(InviteCode.id == code_id).first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="邀请码不存在")
    db.delete(invite)
    db.commit()
    return MessageResponse(message="邀请码已删除")


@app.put("/api/admin/invite-codes/{code_id}/reusable", response_model=InviteCodeResponse, tags=["管理员"])
def admin_update_invite_reusable(
    code_id: int,
    req: UpdateInviteCodeReusableRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员设置邀请码是否可重复使用"""
    invite = db.query(InviteCode).filter(InviteCode.id == code_id).first()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="邀请码不存在")
    invite.is_reusable = req.is_reusable
    db.commit()
    db.refresh(invite)
    invite.owner_username = invite.owner.username if invite.owner else None
    return invite


# ============================================
# 友情链接 API
# ============================================

@app.get("/api/friend-links", response_model=FriendLinkListResponse, tags=["友情链接"])
def list_friend_links(db: Session = Depends(get_db)):
    """获取友情链接列表（按 id 正序，公开）"""
    links = db.query(FriendLink).order_by(FriendLink.id.asc()).all()
    return FriendLinkListResponse(total=len(links), links=links)


@app.post("/api/admin/friend-links", response_model=FriendLinkResponse, status_code=status.HTTP_201_CREATED, tags=["友情链接"])
def create_friend_link(
    req: FriendLinkRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """创建友情链接（仅管理员）"""
    link = FriendLink(
        name=req.name,
        url=req.url,
        description=req.description,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@app.get("/api/admin/friend-links", response_model=FriendLinkListResponse, tags=["友情链接"])
def admin_list_friend_links(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理端友情链接列表（按 id 正序，仅管理员）"""
    links = db.query(FriendLink).order_by(FriendLink.id.asc()).all()
    return FriendLinkListResponse(total=len(links), links=links)


@app.put("/api/admin/friend-links/{link_id}", response_model=FriendLinkResponse, tags=["友情链接"])
def update_friend_link(
    link_id: int,
    req: UpdateFriendLinkRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """更新友情链接（仅管理员，非 None 字段逐个更新）"""
    link = db.query(FriendLink).filter(FriendLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="友情链接不存在")
    if req.name is not None:
        link.name = req.name
    if req.url is not None:
        link.url = req.url
    if "description" in req.model_fields_set:
        link.description = req.description or None
    db.commit()
    db.refresh(link)
    return link


@app.delete("/api/admin/friend-links/{link_id}", response_model=MessageResponse, tags=["友情链接"])
def delete_friend_link(
    link_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """删除友情链接（仅管理员）"""
    link = db.query(FriendLink).filter(FriendLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="友情链接不存在")
    db.delete(link)
    db.commit()
    return MessageResponse(message="友情链接已删除")


# ============================================
# 启动入口
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
