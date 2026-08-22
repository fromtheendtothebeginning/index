# features/auth_routes.py — 认证（注册/登录）

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import create_access_token, hash_password, verify_password
from database import get_db
from deps import _client_ip
from models import InviteCode, User
from ratelimit import login_ip, login_user, register_ip
from schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse

router = APIRouter()


@router.post("/api/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, tags=["认证"])
def register(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    """用户注册（需邀请码）"""
    if not register_ip.allow(_client_ip(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁，请稍后再试",
        )

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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="用户名已被注册",
        )
    db.refresh(user)

    # 标记邀请码已使用（可重复使用的邀请码也标记，但不阻止再次使用）
    from datetime import datetime, timezone
    invite.is_used = True
    invite.used_by = user.id
    invite.used_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码无效",
        )

    # 为新用户自动生成专属邀请码（可重复使用）
    user_code = secrets.token_urlsafe(8).upper().replace("-", "").replace("_", "")[:12]
    user_invite = InviteCode(
        code=user_code,
        created_by=user.id,
        owner_user_id=user.id,
        is_reusable=True,
    )
    db.add(user_invite)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="专属邀请码生成失败",
        )

    token = create_access_token({"sub": str(user.id), "username": user.username, "ver": user.token_version})

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/api/login", response_model=TokenResponse, tags=["认证"])
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """用户登录"""
    if not login_ip.allow(_client_ip(request)) or not login_user.allow(req.username):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁，请稍后再试",
        )

    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    token = create_access_token({"sub": str(user.id), "username": user.username, "ver": user.token_version})

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )
