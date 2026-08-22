# features/blogs.py — 博客

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from database import get_db
from constants import ROLE_ADMIN
from deps import _escape_like, get_current_user_obj, get_optional_user, oauth2_scheme_optional
from models import Blog, BlogLike, Comment, Project, User
from schemas import (
    BlogListResponse, BlogResponse, CreateBlogRequest,
    MessageResponse, UpdateBlogRequest,
)

router = APIRouter()


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


@router.get("/api/blogs", response_model=BlogListResponse, tags=["博客"])
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
        _escaped = _escape_like(q)
        query = query.filter(or_(
            Blog.title.like(f"%{_escaped}%", escape="\\"),
            Blog.content_md.like(f"%{_escaped}%", escape="\\"),
        ))
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


@router.get("/api/blogs/{blog_id}", response_model=BlogResponse, tags=["博客"])
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


@router.post("/api/blogs", response_model=BlogResponse, status_code=status.HTTP_201_CREATED, tags=["博客"])
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


@router.put("/api/blogs/{blog_id}", response_model=BlogResponse, tags=["博客"])
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
    is_admin = current_user.role == ROLE_ADMIN
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


@router.delete("/api/blogs/{blog_id}", response_model=MessageResponse, tags=["博客"])
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
    is_admin = current_user.role == ROLE_ADMIN
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人博客")

    db.delete(blog)
    db.commit()
    return MessageResponse(message="博客已删除")
