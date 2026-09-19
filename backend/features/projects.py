# features/projects.py — 项目（含关注）

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from database import get_db
from constants import ROLE_ADMIN
from deps import get_current_user_obj, get_optional_user, oauth2_scheme_optional, require_admin
from features.blogs import _attach_blog_stats
from models import Blog, Notification, Project, ProjectFollow, ProjectLike, User
from schemas import (
    CreateProjectRequest, MessageResponse, ProjectDetailResponse,
    ProjectFollowToggleResponse, ProjectListResponse, ProjectResponse,
    UpdateProjectBlogsRequest, UpdateProjectRequest,
)

router = APIRouter()


def _attach_project_stats(projects, db: Session, current_user: Optional[User]) -> None:
    """为一批项目批量附加点赞数、关注数、当前用户是否点赞/关注（聚合查询，避免逐条 N+1）"""
    projects = list(projects)
    if not projects:
        return
    ids = [p.id for p in projects]
    like_counts = dict(
        db.query(ProjectLike.project_id, func.count(ProjectLike.id))
        .filter(ProjectLike.project_id.in_(ids))
        .group_by(ProjectLike.project_id)
        .all()
    )
    follow_counts = dict(
        db.query(ProjectFollow.project_id, func.count(ProjectFollow.id))
        .filter(ProjectFollow.project_id.in_(ids))
        .group_by(ProjectFollow.project_id)
        .all()
    )
    liked_ids = set()
    followed_ids = set()
    if current_user:
        liked_ids = {
            row[0] for row in db.query(ProjectLike.project_id)
            .filter(ProjectLike.project_id.in_(ids), ProjectLike.user_id == current_user.id)
            .all()
        }
        followed_ids = {
            row[0] for row in db.query(ProjectFollow.project_id)
            .filter(ProjectFollow.project_id.in_(ids), ProjectFollow.user_id == current_user.id)
            .all()
        }
    for p in projects:
        p.like_count = like_counts.get(p.id, 0)
        p.follow_count = follow_counts.get(p.id, 0)
        p.liked_by_me = p.id in liked_ids
        p.followed_by_me = p.id in followed_ids


def _attach_blog_counts(projects, db: Session) -> None:
    """为一批项目批量附加关联博客数"""
    projects = list(projects)
    if not projects:
        return
    counts = dict(
        db.query(Blog.project_id, func.count(Blog.id))
        .filter(Blog.project_id.in_([p.id for p in projects]))
        .group_by(Blog.project_id)
        .all()
    )
    for p in projects:
        p.blog_count = counts.get(p.id, 0)


@router.get("/api/projects", response_model=ProjectListResponse, tags=["项目"])
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
    _attach_blog_counts(projects, db)
    _attach_project_stats(projects, db, current_user)
    return ProjectListResponse(total=total, projects=projects)


@router.get("/api/projects/{project_id}", response_model=ProjectDetailResponse, tags=["项目"])
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
    _attach_blog_stats(blogs, db, current_user)
    project.blogs = blogs
    _attach_project_stats([project], db, current_user)
    return project


@router.post("/api/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED, tags=["项目"])
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


@router.put("/api/projects/{project_id}", response_model=ProjectResponse, tags=["项目"])
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
    is_admin = current_user.role == ROLE_ADMIN
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


@router.put("/api/projects/{project_id}/blogs", response_model=ProjectDetailResponse, tags=["项目"])
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
    is_admin = current_user.role == ROLE_ADMIN
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

    # 关联了新博客时，批量通知所有关注者（作者本人除外，同目标未读通知去重）
    if old_blog_ids:
        followers = [
            fid for (fid,) in db.query(ProjectFollow.user_id)
            .filter(ProjectFollow.project_id == project_id).all()
            if fid != project.author_id
        ]
        new_blogs = {b.id: b.title for b in db.query(Blog).filter(Blog.id.in_(old_blog_ids)).all()}
        if followers and new_blogs:
            existing = {
                (n.user_id, n.blog_id)
                for n in db.query(Notification)
                .filter(
                    Notification.user_id.in_(followers),
                    Notification.type == "project_new_blog",
                    Notification.actor_id == project.author_id,
                    Notification.blog_id.in_(new_blogs),
                    Notification.is_read.is_(False),
                )
                .all()
            }
            fresh = [
                Notification(
                    user_id=fid,
                    type="project_new_blog",
                    actor_id=project.author_id,
                    blog_id=bid,
                    comment_id=None,
                    content=f"项目「{project.name}」关联了新博客《{btitle}》",
                )
                for fid in followers
                for bid, btitle in new_blogs.items()
                if (fid, bid) not in existing
            ]
            if fresh:
                db.add_all(fresh)
                db.commit()

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
    _attach_blog_stats(blogs, db, None)
    project.blogs = blogs
    _attach_project_stats([project], db, None)
    return project


@router.delete("/api/projects/{project_id}", response_model=MessageResponse, tags=["项目"])
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
    is_admin = current_user.role == ROLE_ADMIN
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人项目")

    db.delete(project)
    db.commit()
    return MessageResponse(message="项目已删除")


@router.post("/api/projects/{project_id}/follow", response_model=ProjectFollowToggleResponse, tags=["项目"])
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
