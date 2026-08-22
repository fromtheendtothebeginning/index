# deps.py — 跨域共享依赖与助手（自 main.py 逐字搬移，不依赖 features 下任何模块）

from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from auth import decode_access_token
from constants import ROLE_ADMIN
from database import get_db
from models import User, Notification


def _log(msg: str):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")
# 可选鉴权 —— 未携带 token 时不报错，返回 None（用于公开接口附带当前用户信息）
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/login", auto_error=False)


def _client_ip(request: Request) -> str:
    """获取客户端 IP：优先取 X-Forwarded-For 首段（反向代理场景），否则取直连地址"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _escape_like(s: str) -> str:
    """转义 LIKE 通配符，防止搜索词里的 % _ \\ 被当作模式匹配"""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _verify_token(token: str, db: Session) -> Optional[User]:
    """校验 JWT 并返回用户；令牌无效 / 用户不存在 / 令牌版本号与用户不匹配时返回 None"""
    payload = decode_access_token(token)
    if payload is None:
        return None
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    if payload.get("ver") != user.token_version:
        return None
    return user


def get_current_user_obj(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """获取当前用户对象（含令牌版本校验）"""
    user = _verify_token(token, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    return user


def require_admin(current_user: User = Depends(get_current_user_obj)) -> User:
    """管理员权限依赖 —— 非管理员返回 403"""
    if current_user.role != ROLE_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


def get_optional_user(token: Optional[str], db: Session) -> Optional[User]:
    """可选鉴权：传入 Bearer token 时返回用户，否则返回 None"""
    if not token:
        return None
    return _verify_token(token, db)


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
