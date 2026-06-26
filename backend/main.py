# main.py — FastAPI 应用入口

import secrets
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload

from database import get_db, init_db, run_migrations
from models import User, Blog, BlogLike, Comment, InviteCode
from schemas import (
    RegisterRequest, LoginRequest, ResetPasswordRequest, UpdateProfileRequest,
    CreateBlogRequest, UpdateBlogRequest, TokenResponse, UserResponse,
    BlogResponse, BlogListItem, BlogListResponse, MessageResponse,
    LikeToggleResponse, CommentResponse, CommentListResponse, CreateCommentRequest,
    AdminUserResponse, AdminUserListResponse, UpdateUserRoleRequest,
    AdminCommentResponse, AdminCommentListResponse,
    AdminBlogListItem, AdminBlogListResponse, UpdateBlogCategoryRequest,
    InviteCodeResponse, InviteCodeListResponse, CreateInviteCodeResponse,
    UpdateInviteCodeReusableRequest,
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
        .options(joinedload(Blog.author))
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
    blog = db.query(Blog).options(joinedload(Blog.author)).filter(Blog.id == blog_id).first()
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
    blog = Blog(
        title=req.title,
        category=req.category,
        content_md=req.content_md,
        author_id=current_user.id,
    )
    db.add(blog)
    db.commit()
    db.refresh(blog)
    # 重新查询以加载 author 关系
    blog = db.query(Blog).options(joinedload(Blog.author)).filter(Blog.id == blog.id).first()
    _attach_blog_stats(blog, db, current_user)
    return blog


@app.put("/api/blogs/{blog_id}", response_model=BlogResponse, tags=["博客"])
def update_blog(
    blog_id: int,
    req: UpdateBlogRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """更新博客文章（仅作者）"""
    blog = db.query(Blog).options(joinedload(Blog.author)).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")
    if blog.author_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改他人博客")

    if req.title is not None:
        blog.title = req.title
    if req.category is not None:
        blog.category = req.category
    if req.content_md is not None:
        blog.content_md = req.content_md

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
# 点赞 API
# ============================================

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

    like_count = db.query(BlogLike).filter(BlogLike.blog_id == blog_id).count()
    return LikeToggleResponse(liked=liked, like_count=like_count)


# ============================================
# 评论 API
# ============================================

@app.get("/api/blogs/{blog_id}/comments", response_model=CommentListResponse, tags=["评论"])
def list_comments(blog_id: int, db: Session = Depends(get_db)):
    """获取某篇博客的评论列表（按时间正序）"""
    blog = db.query(Blog).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")

    comments = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .filter(Comment.blog_id == blog_id)
        .order_by(Comment.created_at.asc())
        .all()
    )
    return CommentListResponse(total=len(comments), comments=comments)


@app.post("/api/blogs/{blog_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED, tags=["评论"])
def create_comment(
    blog_id: int,
    req: CreateCommentRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """发表评论（需登录）"""
    blog = db.query(Blog).filter(Blog.id == blog_id).first()
    if not blog:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="博客不存在")

    comment = Comment(
        blog_id=blog_id,
        user_id=current_user.id,
        content=req.content,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    # 重新查询以加载 user 关系
    comment = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .filter(Comment.id == comment.id)
        .first()
    )
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
    for c in comments:
        c.blog_title = blog_titles.get(c.blog_id)
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
# 启动入口
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
