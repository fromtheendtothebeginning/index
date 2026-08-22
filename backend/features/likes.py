# features/likes.py — 点赞（博客/项目/评论）

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from deps import _notify, get_current_user_obj
from models import Blog, BlogLike, Comment, CommentLike, Project, ProjectLike, User
from schemas import CommentLikeToggleResponse, LikeToggleResponse

router = APIRouter()


@router.post("/api/blogs/{blog_id}/like", response_model=LikeToggleResponse, tags=["点赞"])
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


@router.post("/api/projects/{project_id}/like", response_model=LikeToggleResponse, tags=["点赞"])
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


@router.post("/api/comments/{comment_id}/like", response_model=CommentLikeToggleResponse, tags=["点赞"])
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
