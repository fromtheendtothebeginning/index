# features/notifications.py — 通知

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from database import get_db
from deps import get_current_user_obj
from models import Notification, User
from schemas import MarkNotificationsReadRequest, MessageResponse, NotificationListResponse

router = APIRouter()

# 单次返回的通知条数上限（防止历史通知无限累积拖垮响应）
_LIST_CAP = 200


@router.get("/api/notifications", response_model=NotificationListResponse, tags=["通知"])
def list_notifications(
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """获取当前用户的通知列表（按时间倒序，最多返回 _LIST_CAP 条）"""
    notifications = (
        db.query(Notification)
        .options(joinedload(Notification.actor))
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(_LIST_CAP)
        .all()
    )
    unread_count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read.is_(False))
        .count()
    )
    total = db.query(Notification).filter(Notification.user_id == current_user.id).count()
    # 附加 actor_username（不在模型中，动态赋值）
    for n in notifications:
        n.actor_username = n.actor.username if n.actor else None
    return NotificationListResponse(
        total=total,
        unread_count=unread_count,
        notifications=notifications,
    )


@router.put("/api/notifications/read", response_model=MessageResponse, tags=["通知"])
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
