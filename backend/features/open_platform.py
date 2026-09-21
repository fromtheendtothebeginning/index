# features/open_platform.py — 开放平台 v2：多 scope 数据接口 + refresh_token
#
# 在 account_binding.py（v1，精简 OAuth2 授权码）之上扩展，保持完全兼容：
#   - 旧客户端不传 scope / grant_type 时行为不变（scope 默认 profile，响应仅新增字段）。
#   - scope 字典在 constants.OPEN_SCOPES；BindToken.scope / BindCode.scope 存空格分隔串，
#     profile 恒包含，旧令牌（scope='profile'）继续有效。
#   - 本文件只新增：刷新令牌表（随 init_db 自动建表，免迁移）、grant_type=refresh_token 的
#     轮换逻辑（由 account_binding.open_token 调用）、按 scope 鉴权的只读数据接口。
#
# 对接文档见 docs/account-binding-api.md。

import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Session

from database import Base, get_db
from deps import _client_ip
from features.account_binding import BindApp, BindToken, TOKEN_TTL_DAYS, _hash, _now, _user_payload
from features.blogs import _attach_blog_stats
from models import Blog, User
from ratelimit import SlidingWindow

router = APIRouter()

REFRESH_TTL_DAYS = 90             # 刷新令牌有效期（轮换式：每次使用即换新）
OPEN_DATA_IP = SlidingWindow(120, 60)  # 数据接口同 IP 每分钟 120 次


# ============================================
# 数据表
# ============================================

class BindRefreshToken(Base):
    """刷新令牌 —— 每用户每应用一条（轮换式）；库中只存 sha256，明文仅签发时返回一次"""
    __tablename__ = "bind_refresh_tokens"
    __table_args__ = (UniqueConstraint("app_id", "user_id", name="uq_bind_refresh_app_user"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    app_id = Column(Integer, ForeignKey("bind_apps.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True, comment="刷新令牌 sha256")
    revoked = Column(Boolean, nullable=False, default=False, server_default="0", comment="是否已作废")
    expires_at = Column(DateTime(timezone=True), nullable=False, comment="过期时间")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")


# ============================================
# 刷新令牌（由 account_binding.open_token 调用）
# ============================================

def issue_refresh_token(db: Session, app_id: int, user_id: int) -> str:
    """签发/轮换刷新令牌（同应用同用户只保留一条，旧的立即作废）。返回明文，仅此一次。"""
    token = "acr_" + secrets.token_urlsafe(32)
    row = (
        db.query(BindRefreshToken)
        .filter(BindRefreshToken.app_id == app_id, BindRefreshToken.user_id == user_id)
        .first()
    )
    expires = _now() + timedelta(days=REFRESH_TTL_DAYS)
    if row:
        row.token_hash = _hash(token)
        row.revoked = False
        row.expires_at = expires
        row.created_at = _now()
    else:
        db.add(BindRefreshToken(
            app_id=app_id,
            user_id=user_id,
            token_hash=_hash(token),
            expires_at=expires,
        ))
    return token


def refresh_grant(db: Session, app: BindApp, refresh_token: Optional[str]) -> dict:
    """grant_type=refresh_token：校验刷新令牌 → 轮换访问令牌与刷新令牌 → 返回与授权码换令牌同构的响应。

    scope 沿用既有绑定的授权范围；用户已解绑 / 绑定已撤销时要求重新走授权码流程。
    """
    if not refresh_token:
        raise HTTPException(status_code=400, detail="缺少 refresh_token")
    row = (
        db.query(BindRefreshToken)
        .filter(BindRefreshToken.token_hash == _hash(refresh_token))
        .first()
    )
    if not row or row.app_id != app.id or row.revoked or row.expires_at < _now():
        raise HTTPException(status_code=400, detail="刷新令牌无效或已过期")

    binding = (
        db.query(BindToken)
        .filter(
            BindToken.app_id == app.id,
            BindToken.user_id == row.user_id,
            BindToken.revoked.is_(False),
        )
        .first()
    )
    user = db.query(User).filter(User.id == row.user_id).first()
    if not binding or not user:
        raise HTTPException(status_code=400, detail="绑定关系不存在，需用户重新授权")

    # 轮换访问令牌（scope 沿用既有授权范围），旧访问令牌立即失效
    token = "act_" + secrets.token_urlsafe(32)
    binding.token_hash = _hash(token)
    binding.revoked = False
    binding.expires_at = _now() + timedelta(days=TOKEN_TTL_DAYS)
    binding.created_at = _now()
    binding.last_used_at = None
    new_refresh = issue_refresh_token(db, app.id, row.user_id)
    db.commit()

    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": TOKEN_TTL_DAYS * 86400,
        "scope": binding.scope,
        "refresh_token": new_refresh,
        "user": _user_payload(user),
    }


# ============================================
# 按 scope 鉴权的只读数据接口
# ============================================

def _resolve_token(request: Request, db: Session, required_scope: str):
    """校验 Bearer 访问令牌与 scope，返回 (app, binding, user)；任何失效情形一律 401，scope 不足 403"""
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="缺少访问令牌")
    binding = (
        db.query(BindToken)
        .filter(BindToken.token_hash == _hash(auth[7:].strip()), BindToken.revoked.is_(False))
        .first()
    )
    if not binding or binding.expires_at < _now():
        raise HTTPException(status_code=401, detail="访问令牌无效或已过期")
    if required_scope and required_scope not in (binding.scope or "").split():
        raise HTTPException(status_code=403, detail="令牌未授权此范围（scope 不足），需用户重新授权")
    app = db.query(BindApp).filter(BindApp.id == binding.app_id).first()
    user = db.query(User).filter(User.id == binding.user_id).first()
    if not app or not app.is_active or not user:
        raise HTTPException(status_code=401, detail="访问令牌无效或已过期")
    binding.last_used_at = _now()
    db.commit()
    return app, binding, user


@router.get("/api/open/blogs", tags=["开放接口"])
def open_blogs(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """读取已绑定用户发布的公开博客列表（scope: blogs:read，只读）"""
    if not OPEN_DATA_IP.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    app, binding, user = _resolve_token(request, db, "blogs:read")

    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    query = db.query(Blog).filter(Blog.author_id == user.id)
    total = query.count()
    blogs = (
        query
        .order_by(Blog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    _attach_blog_stats(blogs, db, None)
    return {
        "app": {"client_id": app.client_id, "name": app.name},
        "scope": binding.scope,
        "total": total,
        "blogs": [{
            "id": b.id,
            "title": b.title,
            "category": b.category,
            "is_featured": bool(b.is_featured),
            "like_count": b.like_count,
            "comment_count": b.comment_count,
            "project_id": b.project_id,
            "created_at": b.created_at,
            "updated_at": b.updated_at,
        } for b in blogs],
    }


@router.get("/api/open/leetcode", tags=["开放接口"])
def open_leetcode(request: Request, db: Session = Depends(get_db)):
    """读取已绑定用户的 LeetCode 数据（scope: leetcode:read，只读；数据为最近一次站点同步的快照）"""
    if not OPEN_DATA_IP.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    app, binding, user = _resolve_token(request, db, "leetcode:read")

    from features.leetcode import LeetcodeBinding, _leetcode_me_payload
    lb = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user.id).first()
    payload = _leetcode_me_payload(lb) if lb else {"bound": False, "leetcode_username": None}
    return {
        "app": {"client_id": app.client_id, "name": app.name},
        "scope": binding.scope,
        "leetcode": payload,
    }
