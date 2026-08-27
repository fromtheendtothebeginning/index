# features/admin.py — 管理员（用户/评论/博客/邀请码）

import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from auth import hash_password
from database import get_db
from deps import require_admin
from models import Blog, Comment, InviteCode, Project, User
from schemas import (
    AdminBlogListItem, AdminBlogListResponse, AdminCommentListResponse,
    AdminUserListResponse, AdminUserResponse, CreateInviteCodeResponse,
    InviteCodeListResponse, InviteCodeResponse, MessageResponse,
    UpdateAdminUserRequest, UpdateBlogCategoryRequest, UpdateBlogFeaturedRequest,
    UpdateInviteCodeReusableRequest, UpdateUserRoleRequest,
)

router = APIRouter()


@router.get("/api/admin/users", response_model=AdminUserListResponse, tags=["管理员"])
def admin_list_users(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """获取所有用户列表（含角色，仅管理员）"""
    users = db.query(User).order_by(User.created_at.asc()).all()
    return AdminUserListResponse(total=len(users), users=users)


@router.put("/api/admin/users/{user_id}/role", response_model=AdminUserResponse, tags=["管理员"])
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


@router.put("/api/admin/users/{user_id}", response_model=AdminUserResponse, tags=["管理员"])
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
        user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)
    return user


@router.delete("/api/admin/users/{user_id}", response_model=MessageResponse, tags=["管理员"])
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


@router.get("/api/admin/comments", response_model=AdminCommentListResponse, tags=["管理员"])
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
    blog_ids = {c.blog_id for c in comments if c.blog_id}
    blog_titles = {}
    if blog_ids:
        blogs = db.query(Blog).filter(Blog.id.in_(blog_ids)).all()
        blog_titles = {b.id: b.title for b in blogs}
    # 批量查询项目标题
    project_ids = {c.project_id for c in comments if c.project_id}
    project_titles = {}
    if project_ids:
        projects = db.query(Project).filter(Project.id.in_(project_ids)).all()
        project_titles = {p.id: p.name for p in projects}
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
        c.project_title = project_titles.get(c.project_id)
        if c.parent_id and c.parent_id in parents:
            pc, pu = parents[c.parent_id]
            c.parent_content = pc.content
            c.parent_username = pu.nickname or pu.username
    return AdminCommentListResponse(total=len(comments), comments=comments)


@router.delete("/api/admin/comments/{comment_id}", response_model=MessageResponse, tags=["管理员"])
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


@router.get("/api/admin/blogs", response_model=AdminBlogListResponse, tags=["管理员"])
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


@router.delete("/api/admin/blogs/{blog_id}", response_model=MessageResponse, tags=["管理员"])
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


@router.put("/api/admin/blogs/{blog_id}/category", response_model=AdminBlogListItem, tags=["管理员"])
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


@router.put("/api/admin/blogs/{blog_id}/featured", response_model=AdminBlogListItem, tags=["管理员"])
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


@router.post("/api/admin/invite-codes", response_model=CreateInviteCodeResponse, status_code=status.HTTP_201_CREATED, tags=["管理员"])
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


@router.get("/api/admin/invite-codes", response_model=InviteCodeListResponse, tags=["管理员"])
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


@router.delete("/api/admin/invite-codes/{code_id}", response_model=MessageResponse, tags=["管理员"])
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


@router.put("/api/admin/invite-codes/{code_id}/reusable", response_model=InviteCodeResponse, tags=["管理员"])
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
