# features/projects.py — 项目（含关注）

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from database import get_db
from constants import ROLE_ADMIN
from deps import _notify, get_current_user_obj, get_optional_user, oauth2_scheme_optional, require_admin
from features.blogs import _attach_blog_stats
from models import Blog, Project, ProjectFollow, ProjectLike, User
from schemas import (
    CreateProjectRequest, MessageResponse, ProjectDetailResponse,
    ProjectFollowToggleResponse, ProjectListResponse, ProjectResponse,
    UpdateProjectBlogsRequest, UpdateProjectRequest,
)

router = APIRouter()


def _attach_project_stats(project: Project, db: Session, current_user: Optional[User]) -> None:
    """为项目对象附加点赞数、关注数、当前用户是否点赞/关注"""
    project.like_count = db.query(ProjectLike).filter(ProjectLike.project_id == project.id).count()
    project.follow_count = db.query(ProjectFollow).filter(ProjectFollow.project_id == project.id).count()
    project.liked_by_me = current_user is not None and db.query(ProjectLike).filter(ProjectLike.project_id == project.id, ProjectLike.user_id == current_user.id).first() is not None
    project.followed_by_me = current_user is not None and db.query(ProjectFollow).filter(ProjectFollow.project_id == project.id, ProjectFollow.user_id == current_user.id).first() is not None


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
    for p in projects:
        p.blog_count = db.query(Blog).filter(Blog.project_id == p.id).count()
        _attach_project_stats(p, db, current_user)
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
    for b in blogs:
        _attach_blog_stats(b, db, current_user)
    project.blogs = blogs
    _attach_project_stats(project, db, current_user)
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
