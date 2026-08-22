# features/comments.py — 评论（博客/项目共用）

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
from constants import ROLE_ADMIN
from deps import _notify, get_current_user_obj, get_optional_user, oauth2_scheme_optional
from models import Blog, Comment, CommentLike, Project, User
from schemas import (
    CommentListResponse, CommentResponse, CreateCommentRequest, MessageResponse,
)

router = APIRouter()


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


@router.get("/api/blogs/{blog_id}/comments", response_model=CommentListResponse, tags=["评论"])
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


@router.get("/api/projects/{project_id}/comments", response_model=CommentListResponse, tags=["评论"])
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


@router.post("/api/blogs/{blog_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED, tags=["评论"])
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


@router.post("/api/projects/{project_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED, tags=["评论"])
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


@router.delete("/api/comments/{comment_id}", response_model=MessageResponse, tags=["评论"])
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
    is_admin = current_user.role == ROLE_ADMIN
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人评论")

    db.delete(comment)
    db.commit()
    return MessageResponse(message="评论已删除")
