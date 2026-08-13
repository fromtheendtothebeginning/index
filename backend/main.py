# main.py — FastAPI 应用入口

import json
import re
import secrets
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, select, func

from database import get_db, init_db, run_migrations
from models import User, Blog, BlogLike, Comment, CommentLike, Notification, InviteCode, Project, FriendLink, SiteSetting, ProjectLike, ProjectFollow, LeetcodeBinding
from schemas import (
    RegisterRequest, LoginRequest, ResetPasswordRequest, UpdateProfileRequest,
    CreateBlogRequest, UpdateBlogRequest, TokenResponse, UserResponse,
    BlogResponse, BlogListItem, BlogListResponse, MessageResponse,
    LikeToggleResponse, CommentLikeToggleResponse, CommentResponse, CommentListResponse,
    CreateCommentRequest, NotificationResponse, NotificationListResponse, MarkNotificationsReadRequest,
    AdminUserResponse, AdminUserListResponse, UpdateUserRoleRequest, UpdateAdminUserRequest,
    AdminCommentResponse, AdminCommentListResponse,
    AdminBlogListItem, AdminBlogListResponse, UpdateBlogCategoryRequest, UpdateBlogFeaturedRequest,
    InviteCodeResponse, InviteCodeListResponse, CreateInviteCodeResponse,
    UpdateInviteCodeReusableRequest,
    CreateProjectRequest, UpdateProjectRequest, ProjectResponse,
    ProjectListResponse, ProjectDetailResponse, UpdateProjectBlogsRequest,
    ProjectLinkItem, ProjectFollowToggleResponse,
    FriendLinkRequest, FriendLinkResponse, FriendLinkListResponse,
    UpdateFriendLinkRequest,
    SiteSettingResponse, UpdateSiteSettingRequest, ContactItem,
    DeleteAccountRequest,
    UpdateLeetcodeRequest, UpdateLeetcodeModeRequest, LeetcodeMeResponse,
    LeetcodeBoardUser, LeetcodeBoardResponse, LeetcodeRefreshResponse,
)
from auth import hash_password, verify_password, create_access_token, decode_access_token

# ============================================
# 应用初始化
# ============================================

app = FastAPI(title="anticraft API", version="1.0.0")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")
# 可选鉴权 —— 未携带 token 时不报错，返回 None（用于公开接口附带当前用户信息）
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/login", auto_error=False)

# CORS —— 允许前端开发服务器跨域访问（生产走 nginx 同源代理，无需跨域）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3300", "http://127.0.0.1:3300"],
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

    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
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

    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
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
    """重置密码（无需登录，需本人专属可重复邀请码验证，防止接管他人账号）"""
    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在",
        )

    # 校验邀请码归属：必须是该账号本人的专属可重复邀请码（不消耗）
    invite = db.query(InviteCode).filter(InviteCode.code == req.invite_code).first()
    if not invite or invite.owner_user_id != user.id or not invite.is_reusable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码无效或不属于该账号",
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
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return user


def require_admin(current_user: User = Depends(get_current_user_obj)) -> User:
    """管理员权限依赖 —— 非管理员返回 403"""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


@app.post("/api/user/delete-account", response_model=MessageResponse, tags=["用户"])
def delete_own_account(
    req: DeleteAccountRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """注销当前账号（需账号与密码验证，博客/评论/点赞/邀请码由外键级联删除）"""
    if req.username != current_user.username or not verify_password(req.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账号或密码错误",
        )

    db.delete(current_user)
    db.commit()
    return MessageResponse(message="账号已注销")


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
    q: Optional[str] = None,
    sort: str = "created",
    from_date: Optional[str] = Query(None, alias="from", description="起始日期 YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, alias="to", description="截止日期 YYYY-MM-DD"),
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """获取博客列表（可按分类/关键词/日期筛选，排序：created 精选优先 / likes 点赞 / comprehensive 综合）"""
    from datetime import date, datetime, timedelta

    current_user = get_optional_user(token, db)
    query = db.query(Blog)
    if category:
        query = query.filter(Blog.category == category)
    if q:
        query = query.filter(or_(Blog.title.like(f"%{q}%"), Blog.content_md.like(f"%{q}%")))
    if from_date:
        try:
            from_dt = datetime.combine(date.fromisoformat(from_date), datetime.min.time())
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from 日期格式非法（应为 YYYY-MM-DD）")
        query = query.filter(Blog.created_at >= from_dt)
    if to_date:
        try:
            to_dt = datetime.combine(date.fromisoformat(to_date), datetime.min.time()) + timedelta(days=1)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="to 日期格式非法（应为 YYYY-MM-DD）")
        query = query.filter(Blog.created_at < to_dt)
    total = query.count()
    like_count_expr = (
        select(func.count(BlogLike.id))
        .where(BlogLike.blog_id == Blog.id)
        .scalar_subquery()
    )
    if sort == "likes":
        query = query.order_by(like_count_expr.desc(), Blog.created_at.desc())
    elif sort == "comprehensive":
        query = query.order_by(
            Blog.is_featured.desc(),  # 精选优先
            # 综合 = 点赞×3（低权重） + 时效因子 10/(距今天数+1)（高权重，新博文最高 10 分 ≈ 3.3 个赞）
            (like_count_expr * 3 + 10 / (func.datediff(func.now(), Blog.created_at) + 1)).desc(),
            Blog.created_at.desc(),
        )
    else:
        query = query.order_by(Blog.created_at.desc())  # 时间排序：纯发布时间倒序，不精选优先
    blogs = (
        query
        .options(joinedload(Blog.author), joinedload(Blog.project))
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


@app.put("/api/admin/users/{user_id}", response_model=AdminUserResponse, tags=["管理员"])
def admin_update_user(
    user_id: int,
    req: UpdateAdminUserRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员更新用户昵称/头像/密码（昵称头像可清空，密码非空时重置）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if "nickname" in req.model_fields_set:
        user.nickname = req.nickname or None
    if "avatar_url" in req.model_fields_set:
        user.avatar_url = req.avatar_url or None
    if req.password:
        user.hashed_password = hash_password(req.password)
    db.commit()
    db.refresh(user)
    return user


@app.delete("/api/admin/users/{user_id}", response_model=MessageResponse, tags=["管理员"])
def admin_delete_user(
    user_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员删除用户（其博客/评论/点赞/项目/邀请码由外键 CASCADE 级联删除）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if user.id == _admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除当前管理员账户")
    db.delete(user)
    db.commit()
    return MessageResponse(message="用户已删除")


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


@app.put("/api/admin/blogs/{blog_id}/featured", response_model=AdminBlogListItem, tags=["管理员"])
def admin_set_blog_featured(
    blog_id: int,
    req: UpdateBlogFeaturedRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员设置博客精选"""
    blog = db.query(Blog).options(joinedload(Blog.author)).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")
    blog.is_featured = req.is_featured
    db.commit()
    db.refresh(blog)
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
# 站点设置 API
# ============================================

_DEFAULT_CONTACT_ITEMS = [
    {"label": "邮箱", "value": "jianghuxingxzhe@icloud.com", "description": "有任何问题，欢迎邮件联系"},
    {"label": "GitHub", "value": "https://github.com/fromtheendtothebeginning", "description": "从尽头到开始，Github 主页"},
]


@app.get("/api/site-settings", response_model=SiteSettingResponse, tags=["站点设置"])
def get_site_settings(db: Session = Depends(get_db)):
    """获取站点联系设置（首页"保持联系"区块，公开，无配置时返回默认项）"""
    setting = db.query(SiteSetting).first()
    if not setting:
        return SiteSettingResponse(email="", github_url="", contact_items=list(_DEFAULT_CONTACT_ITEMS))
    items = setting.contact_items or []
    if not items:
        # 旧数据兼容：由 email/github_url 生成默认两项
        items = [
            {"label": "邮箱", "value": setting.email or _DEFAULT_CONTACT_ITEMS[0]["value"]},
            {"label": "GitHub", "value": setting.github_url or _DEFAULT_CONTACT_ITEMS[1]["value"]},
        ]
    # 旧数据兼容：缺 type/icon 的联系项补默认值
    for it in items:
        it.setdefault("type", "link")
        it.setdefault("icon", "")
        it.setdefault("description", "")
    return SiteSettingResponse(email=setting.email or "", github_url=setting.github_url or "", contact_items=items)


@app.put("/api/admin/site-settings", response_model=SiteSettingResponse, tags=["站点设置"])
def update_site_settings(
    req: UpdateSiteSettingRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """更新站点联系设置（仅管理员，联系项为唯一数据源，邮箱/GitHub 兼容同步）"""
    setting = db.query(SiteSetting).first()
    if not setting:
        setting = SiteSetting(email="", github_url="", contact_items=list(_DEFAULT_CONTACT_ITEMS))
        db.add(setting)
    if "email" in req.model_fields_set:
        setting.email = req.email or ""
    if "github_url" in req.model_fields_set:
        setting.github_url = req.github_url or ""
    if "contact_items" in req.model_fields_set:
        setting.contact_items = [item.model_dump() for item in req.contact_items] if req.contact_items else []
        # 兼容同步：从联系项回写 email/github_url（label 匹配）
        for it in setting.contact_items:
            if it["label"] == "邮箱":
                setting.email = it["value"].replace("mailto:", "").strip()
            elif it["label"] == "GitHub":
                setting.github_url = it["value"].strip()
    db.commit()
    db.refresh(setting)
    return setting


# ============================================
# LeetCode 刷题量 & 公开榜单
# ============================================

LEETCODE_GRAPHQL = "https://leetcode.cn/graphql"
LEETCODE_QUERY = (
    "query userQuestionProgress($userSlug: String!) {"
    " userProfileUserQuestionProgress(userSlug: $userSlug) {"
    "  numAcceptedQuestions { difficulty count }"
    " } }"
)


def fetch_leetcode_progress(username: str):
    """调用 LeetCode 公开 GraphQL 拉取用户各难度已解题数。
    返回 (easy, medium, hard) 或 None（用户不存在）；网络/解析失败抛异常。"""
    body = json.dumps({
        "query": LEETCODE_QUERY,
        "variables": {"userSlug": username},
    }).encode()
    req = urllib.request.Request(
        LEETCODE_GRAPHQL, data=body,
        headers={
            "Content-Type": "application/json",
            "Referer": "https://leetcode.cn/u/" + urllib.parse.quote(username, safe=""),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) anticraft-leetcode-sync",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    inner = data.get("data") or {}
    nums = inner.get("userProfileUserQuestionProgress")
    if not nums or not nums.get("numAcceptedQuestions"):
        # 用户不存在（接口返回空数组 / null）
        return None
    counts = {"EASY": 0, "MEDIUM": 0, "HARD": 0}
    for item in nums["numAcceptedQuestions"]:
        counts[item.get("difficulty", "")] = int(item.get("count") or 0)
    return counts["EASY"], counts["MEDIUM"], counts["HARD"]


def leetcode_inc(binding) -> tuple:
    """8.13 起（绑定日）的刷题增量：当前题数 - 基线，各维度不为负"""
    return (
        max(0, binding.cur_easy - binding.base_easy),
        max(0, binding.cur_medium - binding.base_medium),
        max(0, binding.cur_hard - binding.base_hard),
    )


def leetcode_score(e: int, m: int, h: int, difficulty_mode: bool, serious_mode: bool = False, boost_mode: bool = False) -> float:
    """激励模式：初始 -100 分，简单 3 / 中等 6 / 困难 9；
    否则：简单 2 / 中等 4 / 困难 8，严肃模式简单不计分，困难模式减半"""
    if boost_mode:
        return -100.0 + e * 3 + m * 6 + h * 9
    e_score = 0 if serious_mode else e * 2
    score = e_score + m * 4 + h * 8
    return score / 2 if difficulty_mode else float(score)


def _leetcode_me_payload(binding) -> dict:
    e, m, h = leetcode_inc(binding)
    return {
        "bound": True,
        "leetcode_username": binding.leetcode_username,
        "difficulty_mode": bool(binding.difficulty_mode),
        "serious_mode": bool(binding.serious_mode),
        "boost_mode": bool(binding.boost_mode),
        "base": {"easy": binding.base_easy, "medium": binding.base_medium, "hard": binding.base_hard},
        "cur": {"easy": binding.cur_easy, "medium": binding.cur_medium, "hard": binding.cur_hard},
        "inc": {"easy": e, "medium": m, "hard": h},
        "total_inc": e + m + h,
        "score": leetcode_score(e, m, h, bool(binding.difficulty_mode), bool(binding.serious_mode), bool(binding.boost_mode)),
        "updated_at": binding.updated_at,
        "leetcode_ok": True,
    }


@app.get("/api/leetcode/me", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_me(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """获取当前用户的 LeetCode 绑定与刷题增量（实时同步）"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if not binding:
        return LeetcodeMeResponse(bound=False)
    try:
        prog = fetch_leetcode_progress(binding.leetcode_username)
        if prog is not None:
            binding.cur_easy, binding.cur_medium, binding.cur_hard = prog
            db.commit()
    except Exception:
        pass
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.put("/api/leetcode/me", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_bind(
    req: UpdateLeetcodeRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """绑定/改绑 LeetCode 账号（绑定时刻为 8.13 起算基线）"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    username = req.leetcode_username.strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名不能为空")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名无效，仅支持字母、数字、下划线等字符")
    try:
        prog = fetch_leetcode_progress(username)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无法连接 LeetCode，请稍后重试")
    if prog is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LeetCode 用户不存在")
    existing = db.query(LeetcodeBinding).filter(
        LeetcodeBinding.leetcode_username == username,
        LeetcodeBinding.user_id != user_id,
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该 LeetCode 账号已被其他用户绑定")
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if binding:
        binding.leetcode_username = username
    else:
        binding = LeetcodeBinding(user_id=user_id, leetcode_username=username)
        db.add(binding)
    binding.base_easy, binding.base_medium, binding.base_hard = prog
    binding.cur_easy, binding.cur_medium, binding.cur_hard = prog
    db.commit()
    db.refresh(binding)
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.delete("/api/leetcode/me", response_model=MessageResponse, tags=["LeetCode"])
def leetcode_unbind(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """解绑 LeetCode 账号"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if binding:
        db.delete(binding)
        db.commit()
    return MessageResponse(message="已解绑")


def _enter_boost(binding) -> None:
    """进入激励模式：备份当前基线并清零刷题量（退出时恢复）"""
    if binding.backup_base_easy is None:
        binding.backup_base_easy = binding.base_easy
        binding.backup_base_medium = binding.base_medium
        binding.backup_base_hard = binding.base_hard
    binding.base_easy = binding.cur_easy
    binding.base_medium = binding.cur_medium
    binding.base_hard = binding.cur_hard
    binding.boost_mode = True


def _exit_boost(binding) -> None:
    """退出激励模式：恢复备份的基线（若此前已进入）"""
    if not binding.boost_mode:
        return
    if binding.backup_base_easy is not None:
        binding.base_easy = binding.backup_base_easy
        binding.base_medium = binding.backup_base_medium
        binding.base_hard = binding.backup_base_hard
        binding.backup_base_easy = None
        binding.backup_base_medium = None
        binding.backup_base_hard = None
    binding.boost_mode = False


@app.put("/api/leetcode/me/mode", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_mode(
    req: UpdateLeetcodeModeRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """切换模式（激励与困难/严肃互斥；进入激励备份并清零刷题量，退出恢复）"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if not binding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="尚未绑定 LeetCode 账号")
    # 三模式互斥：激励与困难/严肃不可共存
    if req.boost_mode is True:
        _enter_boost(binding)
    if req.difficulty_mode is True:
        _exit_boost(binding)
        binding.difficulty_mode = True
    if req.serious_mode is True:
        _exit_boost(binding)
        binding.serious_mode = True
    if req.boost_mode is False:
        _exit_boost(binding)
    if req.difficulty_mode is False:
        binding.difficulty_mode = False
    if req.serious_mode is False:
        binding.serious_mode = False
    db.commit()
    db.refresh(binding)
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.get("/api/leetcode/leaderboard", response_model=LeetcodeBoardResponse, tags=["LeetCode"])
def leetcode_leaderboard(db: Session = Depends(get_db)):
    """公开榜单：从 8.13 起的刷题增量，按得分排序（缓存数据，不实时同步）"""
    rows = (
        db.query(LeetcodeBinding)
        .options(joinedload(LeetcodeBinding.user))
        .order_by(LeetcodeBinding.created_at.asc())
        .all()
    )
    users = []
    for b in rows:
        e, m, h = leetcode_inc(b)
        users.append({
            "user_id": b.user_id,
            "nickname": b.user.nickname if b.user else None,
            "username": b.user.username if b.user else "已注销",
            "avatar_url": b.user.avatar_url if b.user else None,
            "leetcode_username": b.leetcode_username,
            "difficulty_mode": bool(b.difficulty_mode),
            "serious_mode": bool(b.serious_mode),
            "boost_mode": bool(b.boost_mode),
            "easy": e,
            "medium": m,
            "hard": h,
            "total": e + m + h,
            "score": leetcode_score(e, m, h, bool(b.difficulty_mode), bool(b.serious_mode), bool(b.boost_mode)),
            "updated_at": b.updated_at,
        })
    users.sort(key=lambda u: (-u["score"], -u["total"], u["user_id"]))
    return LeetcodeBoardResponse(users=users, generated_at=datetime.now(timezone.utc))


def _sync_leetcode_one(bid: int, username: str) -> bool:
    """同步单个绑定（独立 Session，供并发刷新使用）"""
    from database import SessionLocal
    db = SessionLocal()
    try:
        binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.id == bid).first()
        if not binding:
            return False
        prog = fetch_leetcode_progress(username)
        if prog is None:
            return False
        binding.cur_easy, binding.cur_medium, binding.cur_hard = prog
        db.commit()
        return True
    except Exception:
        db.rollback()
        return False
    finally:
        db.close()


@app.post("/api/leetcode/refresh", response_model=LeetcodeRefreshResponse, tags=["LeetCode"])
def leetcode_refresh(db: Session = Depends(get_db)):
    """同步所有绑定用户的 LeetCode 数据（并发重新请求，失败者保留旧值）"""
    bindings = db.query(LeetcodeBinding).all()
    if not bindings:
        return LeetcodeRefreshResponse(synced=0, total=0)
    tasks = [(b.id, b.leetcode_username) for b in bindings]
    synced = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = pool.map(lambda t: _sync_leetcode_one(*t), tasks)
        synced = sum(1 for ok in results if ok)
    return LeetcodeRefreshResponse(synced=synced, total=len(bindings))


# ============================================
# 启动入口
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
