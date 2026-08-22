# main.py — FastAPI 应用入口

import json
import os
import re
import secrets
import socket
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, select, func
from sqlalchemy.exc import IntegrityError

import ipaddress
import tempfile
import tools
import aisettings

from database import get_db, init_db, run_migrations
from models import User, Blog, BlogLike, Comment, CommentLike, Notification, InviteCode, Project, FriendLink, SiteSetting, ProjectLike, ProjectFollow, LeetcodeBinding, AiSetting, AiKey, AiFavorite, AiModel
from schemas import (
    RegisterRequest, LoginRequest, ResetPasswordRequest, UpdateProfileRequest,
    CreateBlogRequest, UpdateBlogRequest, TokenResponse, UserResponse,
    BlogResponse, BlogListItem, BlogListResponse, MessageResponse,
    LikeToggleResponse, CommentLikeToggleResponse, CommentResponse, CommentListResponse,
    CreateCommentRequest, NotificationResponse, NotificationListResponse, MarkNotificationsReadRequest,
    AdminUserResponse, AdminUserListResponse, UpdateUserRoleRequest, UpdateAdminUserRequest,
    AdminCommentResponse, AdminCommentListResponse,
    AdminBlogListItem, AdminBlogListResponse, UpdateBlogCategoryRequest, UpdateBlogFeaturedRequest,
    InviteCodeResponse, InviteCodeListResponse, CreateInviteCodeResponse,
    UpdateInviteCodeReusableRequest,
    CreateProjectRequest, UpdateProjectRequest, ProjectResponse,
    ProjectListResponse, ProjectDetailResponse, UpdateProjectBlogsRequest,
    ProjectLinkItem, ProjectFollowToggleResponse,
    FriendLinkRequest, FriendLinkResponse, FriendLinkListResponse,
    UpdateFriendLinkRequest,
    SiteSettingResponse, UpdateSiteSettingRequest, ContactItem,
    DeleteAccountRequest,
    UpdateLeetcodeRequest, UpdateLeetcodeModeRequest, LeetcodeMeResponse,
    LeetcodeBoardUser, LeetcodeBoardResponse, LeetcodeRefreshResponse,
    UpdateLeetcodeDebugRequest, LeetcodeDebugSetRequest,
    AiSettingsResponse, UpdateAiSettingsRequest, AiSettingsTestRequest, AiSettingsTestResponse,
    AiKeyResponse, AiKeysResponse, CreateAiKeyRequest, UpdateAiKeyRequest,
    AiModelsResponse, AiFavoriteToggleRequest, AiFavoriteToggleResponse,
    AiCustomModelRequest, AiCustomModelResponse,
)
from auth import hash_password, verify_password, create_access_token, decode_access_token
from ratelimit import login_ip, login_user, register_ip, reset_ip, check_username_ip, reset_lock

# ============================================
# 应用初始化
# ============================================

app = FastAPI(title="anticraft API", version="1.0.0")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")
# 可选鉴权 —— 未携带 token 时不报错，返回 None（用于公开接口附带当前用户信息）
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/login", auto_error=False)

# CORS —— 允许前端开发服务器跨域访问（生产走 nginx 同源代理，无需跨域）
_cors_origins = [
    o.strip() for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3300,http://127.0.0.1:3300",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# 运行日志（启动 banner + 请求中间件 + 关键事件），便于命令行观察后端状态
# ============================================
import time as _time

def _log(msg: str):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    start = _time.time()
    response = await call_next(request)
    dur = (_time.time() - start) * 1000
    path = request.url.path
    # 记录工具相关请求 + 所有 4xx/5xx 错误，避免刷屏
    if path.startswith("/api/tools") or response.status_code >= 400:
        _log(f"req {request.method} {path} -> {response.status_code} ({dur:.0f}ms)")
    return response


@app.on_event("startup")
def on_startup():
    """首次启动自动建表 + 迁移新字段 + 启动 LeetCode 心跳"""
    _log("=" * 50)
    _log("anticraft API 启动")
    _log(f"端口 {os.getenv('PORT', '8000')} · 视频工具已加载 (yt-dlp) · HOST={os.getenv('HOST', '127.0.0.1')}")
    _log("=" * 50)
    init_db()
    run_migrations()
    _start_heartbeat()
    _log("启动完成：数据库就绪，心跳已启动")


# ============================================
# API 路由
# ============================================

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
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


@app.get("/api/health", tags=["系统"])
def health_check():
    """健康检查"""
    return {"status": "ok", "message": "anticraft API is running"}


@app.post("/api/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, tags=["认证"])
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


@app.post("/api/login", response_model=TokenResponse, tags=["认证"])
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


@app.get("/api/user/me", response_model=UserResponse, tags=["用户"])
def get_current_user(current_user: User = Depends(get_current_user_obj)):
    """获取当前登录用户信息（需 Bearer Token）"""
    return UserResponse.model_validate(current_user)


@app.put("/api/user/profile", response_model=UserResponse, tags=["用户"])
def update_profile(
    req: UpdateProfileRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """更新当前用户昵称和头像"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")

    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    if req.nickname is not None:
        user.nickname = req.nickname
    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url

    db.commit()
    db.refresh(user)

    return UserResponse.model_validate(user)


@app.get("/api/user/check-username", tags=["用户"])
def check_username(username: str, request: Request, db: Session = Depends(get_db)):
    """检查用户名是否存在"""
    if not check_username_ip.allow(_client_ip(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁，请稍后再试",
        )
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return {"exists": True, "username": user.username}


# ============================================
# AI 设置（多 Key 管理 + 动态模型 + 收藏 + 当前选择）
# ============================================

def _ai_key_response(k: AiKey) -> AiKeyResponse:
    key_hint = None
    if k.api_key_enc:
        plain = aisettings.decrypt_secret(k.api_key_enc)
        if plain:
            key_hint = aisettings.mask_key(plain)
    return AiKeyResponse(
        id=k.id,
        provider=k.provider,
        label=k.label or "",
        has_key=bool(k.api_key_enc),
        key_hint=key_hint,
        custom_base_url=k.custom_base_url,
        last_model=k.last_model,
        last_thinking_level=k.last_thinking_level,
        last_temperature=k.last_temperature,
        last_top_k=k.last_top_k,
        created_at=k.created_at,
    )


def _get_or_create_ai_setting(db: Session, user_id: int) -> AiSetting:
    s = db.query(AiSetting).filter(AiSetting.user_id == user_id).first()
    if not s:
        s = AiSetting(user_id=user_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _get_key(db: Session, key_id: int, user_id: int) -> AiKey:
    k = db.query(AiKey).filter(AiKey.id == key_id, AiKey.user_id == user_id).first()
    if not k:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key 不存在")
    return k


# ── 当前选择（thinking/temperature/top_k/key_id/model）──

@app.get("/api/user/ai-settings", response_model=AiSettingsResponse, tags=["AI 设置"])
def get_ai_settings(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    s = _get_or_create_ai_setting(db, current_user.id)
    return AiSettingsResponse(
        key_id=s.key_id,
        model=s.model or "",
        thinking_level=s.thinking_level,
        temperature=float(s.temperature),
        top_k=int(s.top_k),
        updated_at=s.updated_at,
    )


@app.put("/api/user/ai-settings", response_model=AiSettingsResponse, tags=["AI 设置"])
def update_ai_settings(
    req: UpdateAiSettingsRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    s = _get_or_create_ai_setting(db, current_user.id)

    if req.restore:
        # ── 切换 Key：恢复该 Key 上次的选择（忽略其余字段）──
        if not req.key_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="restore 需要 key_id")
        key = _get_key(db, req.key_id, current_user.id)
        s.key_id = key.id
        p = aisettings.get_provider(key.provider)
        s.model = key.last_model or (p.get("default_model", "") if p else "") or ""
        s.thinking_level = key.last_thinking_level or "medium"
        s.temperature = key.last_temperature if key.last_temperature is not None else 0.7
        s.top_k = key.last_top_k if key.last_top_k is not None else 40
    else:
        # ── 保存当前选择：写入 settings，并同步到当前 Key 的 last_*（下次切换恢复）──
        current_key = db.query(AiKey).filter(AiKey.id == s.key_id).first() if s.key_id else None
        if req.key_id is not None:
            if req.key_id == 0:
                s.key_id = None
            elif req.key_id != s.key_id:
                # 带了不同 key_id 但没带 restore：仅切换选中，不恢复（兼容旧调用）
                _get_key(db, req.key_id, current_user.id)
                s.key_id = req.key_id
                current_key = db.query(AiKey).filter(AiKey.id == s.key_id).first()
        if req.model is not None:
            s.model = (req.model or "").strip()[:100]
            if current_key:
                current_key.last_model = s.model or None
        if req.thinking_level is not None:
            s.thinking_level = req.thinking_level
            if current_key:
                current_key.last_thinking_level = req.thinking_level
        if req.temperature is not None:
            s.temperature = req.temperature
            if current_key:
                current_key.last_temperature = req.temperature
        if req.top_k is not None:
            s.top_k = req.top_k
            if current_key:
                current_key.last_top_k = req.top_k

    db.commit()
    db.refresh(s)
    return AiSettingsResponse(
        key_id=s.key_id, model=s.model or "", thinking_level=s.thinking_level,
        temperature=float(s.temperature), top_k=int(s.top_k), updated_at=s.updated_at,
    )


# ── 多 Key 管理 ──

@app.get("/api/user/ai-keys", response_model=AiKeysResponse, tags=["AI 设置"])
def list_ai_keys(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    keys = db.query(AiKey).filter(AiKey.user_id == current_user.id).order_by(AiKey.id).all()
    return AiKeysResponse(keys=[_ai_key_response(k) for k in keys])


@app.post("/api/user/ai-keys", response_model=AiKeyResponse, status_code=status.HTTP_201_CREATED, tags=["AI 设置"])
def create_ai_key(
    req: CreateAiKeyRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    if not aisettings.get_provider(req.provider):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未知的 AI 提供商")
    if req.provider == "custom" and not req.custom_base_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="自定义提供商必须填写 Base URL")
    # 默认模型：该提供商注册表的 default_model（作为此 Key 的初始 last_model）
    p = aisettings.get_provider(req.provider)
    k = AiKey(
        user_id=current_user.id,
        provider=req.provider,
        label=(req.label or "").strip()[:50],
        api_key_enc=aisettings.encrypt_secret(req.api_key.strip()),
        custom_base_url=req.custom_base_url,
        last_model=(p.get("default_model") or "") or None,
        last_thinking_level=None,
        last_temperature=None,
        last_top_k=None,
    )
    db.add(k)
    db.commit()
    db.refresh(k)
    return _ai_key_response(k)


@app.put("/api/user/ai-keys/{key_id}", response_model=AiKeyResponse, tags=["AI 设置"])
def update_ai_key(
    key_id: int,
    req: UpdateAiKeyRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    k = _get_key(db, key_id, current_user.id)
    if req.label is not None:
        k.label = req.label.strip()[:50]
    if req.custom_base_url is not None:
        k.custom_base_url = req.custom_base_url
    if req.api_key is not None and req.api_key.strip():
        k.api_key_enc = aisettings.encrypt_secret(req.api_key.strip())
    db.commit()
    db.refresh(k)
    return _ai_key_response(k)


@app.delete("/api/user/ai-keys/{key_id}", response_model=MessageResponse, tags=["AI 设置"])
def delete_ai_key(
    key_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    k = _get_key(db, key_id, current_user.id)
    s = db.query(AiSetting).filter(AiSetting.user_id == current_user.id).first()
    if s and s.key_id == key_id:
        s.key_id = None
    db.delete(k)
    db.commit()
    return MessageResponse(message="Key 已删除")


@app.get("/api/user/ai-keys/{key_id}/models", response_model=AiModelsResponse, tags=["AI 设置"])
def list_ai_key_models(
    key_id: int,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """用该 Key 调提供商 /models 列出可用模型（动态）"""
    k = _get_key(db, key_id, current_user.id)
    api_key = aisettings.decrypt_secret(k.api_key_enc) if k.api_key_enc else None
    if not api_key:
        return AiModelsResponse(provider=k.provider, models=[], error="该 Key 无有效凭证")
    ok, models, error = aisettings.list_models(k.provider, api_key, k.custom_base_url)
    return AiModelsResponse(provider=k.provider, models=models, error=None if ok else error)


# ── 收藏模型 ──

@app.get("/api/user/ai-favorites", response_model=AiFavoriteToggleResponse, tags=["AI 设置"])
def list_ai_favorites(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    favs = db.query(AiFavorite).filter(AiFavorite.user_id == current_user.id).all()
    return AiFavoriteToggleResponse(favorited=False, favorites=[f.model for f in favs])


@app.post("/api/user/ai-favorites/toggle", response_model=AiFavoriteToggleResponse, tags=["AI 设置"])
def toggle_ai_favorite(
    req: AiFavoriteToggleRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(AiFavorite)
        .filter(AiFavorite.user_id == current_user.id, AiFavorite.provider == req.provider, AiFavorite.model == req.model)
        .first()
    )
    if existing:
        db.delete(existing)
        favorited = False
    else:
        db.add(AiFavorite(user_id=current_user.id, provider=req.provider, model=req.model))
        favorited = True
    db.commit()
    favs = db.query(AiFavorite).filter(AiFavorite.user_id == current_user.id).all()
    return AiFavoriteToggleResponse(favorited=favorited, favorites=[f.model for f in favs])


# ── 手动新增/自定义模型 ──

@app.get("/api/user/ai-models", response_model=AiCustomModelResponse, tags=["AI 设置"])
def list_ai_models(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    rows = db.query(AiModel).filter(AiModel.user_id == current_user.id).order_by(AiModel.id).all()
    return AiCustomModelResponse(models=[r.model for r in rows])


@app.post("/api/user/ai-models", response_model=AiCustomModelResponse, tags=["AI 设置"])
def add_ai_model(
    req: AiCustomModelRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    exists = (
        db.query(AiModel)
        .filter(AiModel.user_id == current_user.id, AiModel.provider == req.provider, AiModel.model == req.model)
        .first()
    )
    if not exists:
        db.add(AiModel(user_id=current_user.id, provider=req.provider, model=req.model))
        db.commit()
    rows = db.query(AiModel).filter(AiModel.user_id == current_user.id, AiModel.provider == req.provider).order_by(AiModel.id).all()
    return AiCustomModelResponse(models=[r.model for r in rows])


@app.delete("/api/user/ai-models", response_model=AiCustomModelResponse, tags=["AI 设置"])
def remove_ai_model(
    req: AiCustomModelRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    db.query(AiModel).filter(
        AiModel.user_id == current_user.id, AiModel.provider == req.provider, AiModel.model == req.model
    ).delete()
    db.commit()
    rows = db.query(AiModel).filter(AiModel.user_id == current_user.id, AiModel.provider == req.provider).order_by(AiModel.id).all()
    return AiCustomModelResponse(models=[r.model for r in rows])


# ── 测试连接 ──

@app.post("/api/user/ai-settings/test", response_model=AiSettingsTestResponse, tags=["AI 设置"])
def test_ai_settings(
    req: AiSettingsTestRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """用指定 Key（缺省=当前选中）向提供商发一条极小请求，验证连通性"""
    key_id = req.key_id
    if key_id is None:
        s = _get_or_create_ai_setting(db, current_user.id)
        key_id = s.key_id
        model_default = s.model
    else:
        model_default = None
    if not key_id:
        return AiSettingsTestResponse(ok=False, error="请先选择一个 API Key")
    k = _get_key(db, key_id, current_user.id)
    p = aisettings.get_provider(k.provider)
    if not p:
        return AiSettingsTestResponse(ok=False, error="未知的 AI 提供商")
    api_key = aisettings.decrypt_secret(k.api_key_enc) if k.api_key_enc else None
    if not api_key:
        return AiSettingsTestResponse(ok=False, error="该 Key 无有效凭证")
    model = (req.model or model_default or p["default_model"]).strip()
    ok, latency_ms, error = aisettings.test_chat(k.provider, api_key, model, k.custom_base_url)
    return AiSettingsTestResponse(ok=ok, latency_ms=latency_ms, error=error)


@app.put("/api/user/reset-password", response_model=MessageResponse, tags=["用户"])
def reset_password(req: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """重置密码（无需登录，需本人专属可重复邀请码验证，防止接管他人账号）"""
    if not reset_ip.allow(_client_ip(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁，请稍后再试",
        )

    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在",
        )

    if not reset_lock.check(user.username):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="尝试次数过多，请 15 分钟后再试",
        )

    # 校验邀请码归属：必须是该账号本人的专属可重复邀请码（不消耗）
    invite = db.query(InviteCode).filter(InviteCode.code == req.invite_code).first()
    if not invite or invite.owner_user_id != user.id or not invite.is_reusable:
        reset_lock.fail(user.username)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码无效或不属于该账号",
        )

    user.hashed_password = hash_password(req.new_password)
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    reset_lock.clear(user.username)

    return MessageResponse(message="密码重置成功")


# ============================================
# 博客 API
# ============================================

@app.post("/api/user/delete-account", response_model=MessageResponse, tags=["用户"])
def delete_own_account(
    req: DeleteAccountRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """注销当前账号（需账号与密码验证，博客/评论/点赞/邀请码由外键级联删除）"""
    if req.username != current_user.username or not verify_password(req.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账号或密码错误",
        )

    db.delete(current_user)
    db.commit()
    return MessageResponse(message="账号已注销")


def get_optional_user(token: Optional[str], db: Session) -> Optional[User]:
    """可选鉴权：传入 Bearer token 时返回用户，否则返回 None"""
    if not token:
        return None
    return _verify_token(token, db)


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


def _attach_project_stats(project: Project, db: Session, current_user: Optional[User]) -> None:
    """为项目对象附加点赞数、关注数、当前用户是否点赞/关注"""
    project.like_count = db.query(ProjectLike).filter(ProjectLike.project_id == project.id).count()
    project.follow_count = db.query(ProjectFollow).filter(ProjectFollow.project_id == project.id).count()
    project.liked_by_me = current_user is not None and db.query(ProjectLike).filter(ProjectLike.project_id == project.id, ProjectLike.user_id == current_user.id).first() is not None
    project.followed_by_me = current_user is not None and db.query(ProjectFollow).filter(ProjectFollow.project_id == project.id, ProjectFollow.user_id == current_user.id).first() is not None


@app.get("/api/blogs", response_model=BlogListResponse, tags=["博客"])
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


@app.get("/api/blogs/{blog_id}", response_model=BlogResponse, tags=["博客"])
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


@app.post("/api/blogs", response_model=BlogResponse, status_code=status.HTTP_201_CREATED, tags=["博客"])
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


@app.put("/api/blogs/{blog_id}", response_model=BlogResponse, tags=["博客"])
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
    is_admin = current_user.role == "admin"
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


@app.delete("/api/blogs/{blog_id}", response_model=MessageResponse, tags=["博客"])
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
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人博客")

    db.delete(blog)
    db.commit()
    return MessageResponse(message="博客已删除")


# ============================================
# 项目 API
# ============================================

@app.get("/api/projects", response_model=ProjectListResponse, tags=["项目"])
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


@app.get("/api/projects/{project_id}", response_model=ProjectDetailResponse, tags=["项目"])
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


@app.post("/api/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED, tags=["项目"])
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


@app.put("/api/projects/{project_id}", response_model=ProjectResponse, tags=["项目"])
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
    is_admin = current_user.role == "admin"
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


@app.put("/api/projects/{project_id}/blogs", response_model=ProjectDetailResponse, tags=["项目"])
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
    is_admin = current_user.role == "admin"
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


@app.delete("/api/projects/{project_id}", response_model=MessageResponse, tags=["项目"])
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
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人项目")

    db.delete(project)
    db.commit()
    return MessageResponse(message="项目已删除")


@app.post("/api/projects/{project_id}/follow", response_model=ProjectFollowToggleResponse, tags=["项目"])
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


# ============================================
# 点赞 API
# ============================================

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


@app.post("/api/blogs/{blog_id}/like", response_model=LikeToggleResponse, tags=["点赞"])
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


@app.post("/api/projects/{project_id}/like", response_model=LikeToggleResponse, tags=["点赞"])
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


@app.post("/api/comments/{comment_id}/like", response_model=CommentLikeToggleResponse, tags=["点赞"])
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


# ============================================
# 评论 API
# ============================================

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


@app.get("/api/blogs/{blog_id}/comments", response_model=CommentListResponse, tags=["评论"])
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


@app.get("/api/projects/{project_id}/comments", response_model=CommentListResponse, tags=["评论"])
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


@app.post("/api/blogs/{blog_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED, tags=["评论"])
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


@app.post("/api/projects/{project_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED, tags=["评论"])
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


@app.delete("/api/comments/{comment_id}", response_model=MessageResponse, tags=["评论"])
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
    is_admin = current_user.role == "admin"
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除他人评论")

    db.delete(comment)
    db.commit()
    return MessageResponse(message="评论已删除")


# ============================================
# 通知 API
# ============================================

@app.get("/api/notifications", response_model=NotificationListResponse, tags=["通知"])
def list_notifications(
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """获取当前用户的通知列表（按时间倒序）"""
    notifications = (
        db.query(Notification)
        .options(joinedload(Notification.actor))
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .all()
    )
    unread_count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read.is_(False))
        .count()
    )
    # 附加 actor_username（不在模型中，动态赋值）
    for n in notifications:
        n.actor_username = n.actor.username if n.actor else None
    return NotificationListResponse(
        total=len(notifications),
        unread_count=unread_count,
        notifications=notifications,
    )


@app.put("/api/notifications/read", response_model=MessageResponse, tags=["通知"])
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


# ============================================
# 管理员 API
# ============================================

@app.get("/api/admin/users", response_model=AdminUserListResponse, tags=["管理员"])
def admin_list_users(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """获取所有用户列表（含角色，仅管理员）"""
    users = db.query(User).order_by(User.created_at.asc()).all()
    return AdminUserListResponse(total=len(users), users=users)


@app.put("/api/admin/users/{user_id}/role", response_model=AdminUserResponse, tags=["管理员"])
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


@app.put("/api/admin/users/{user_id}", response_model=AdminUserResponse, tags=["管理员"])
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


@app.delete("/api/admin/users/{user_id}", response_model=MessageResponse, tags=["管理员"])
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


@app.get("/api/admin/comments", response_model=AdminCommentListResponse, tags=["管理员"])
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
    blog_ids = {c.blog_id for c in comments}
    blog_titles = {}
    if blog_ids:
        blogs = db.query(Blog).filter(Blog.id.in_(blog_ids)).all()
        blog_titles = {b.id: b.title for b in blogs}
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
        if c.parent_id and c.parent_id in parents:
            pc, pu = parents[c.parent_id]
            c.parent_content = pc.content
            c.parent_username = pu.nickname or pu.username
    return AdminCommentListResponse(total=len(comments), comments=comments)


@app.delete("/api/admin/comments/{comment_id}", response_model=MessageResponse, tags=["管理员"])
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


@app.get("/api/admin/blogs", response_model=AdminBlogListResponse, tags=["管理员"])
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


@app.delete("/api/admin/blogs/{blog_id}", response_model=MessageResponse, tags=["管理员"])
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


@app.put("/api/admin/blogs/{blog_id}/category", response_model=AdminBlogListItem, tags=["管理员"])
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


@app.put("/api/admin/blogs/{blog_id}/featured", response_model=AdminBlogListItem, tags=["管理员"])
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


@app.post("/api/admin/invite-codes", response_model=CreateInviteCodeResponse, status_code=status.HTTP_201_CREATED, tags=["管理员"])
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


@app.get("/api/admin/invite-codes", response_model=InviteCodeListResponse, tags=["管理员"])
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


@app.delete("/api/admin/invite-codes/{code_id}", response_model=MessageResponse, tags=["管理员"])
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


@app.put("/api/admin/invite-codes/{code_id}/reusable", response_model=InviteCodeResponse, tags=["管理员"])
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


# ============================================
# 友情链接 API
# ============================================

@app.get("/api/friend-links", response_model=FriendLinkListResponse, tags=["友情链接"])
def list_friend_links(db: Session = Depends(get_db)):
    """获取友情链接列表（按 id 正序，公开）"""
    links = db.query(FriendLink).order_by(FriendLink.id.asc()).all()
    return FriendLinkListResponse(total=len(links), links=links)


@app.post("/api/admin/friend-links", response_model=FriendLinkResponse, status_code=status.HTTP_201_CREATED, tags=["友情链接"])
def create_friend_link(
    req: FriendLinkRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """创建友情链接（仅管理员）"""
    link = FriendLink(
        name=req.name,
        url=req.url,
        description=req.description,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@app.get("/api/admin/friend-links", response_model=FriendLinkListResponse, tags=["友情链接"])
def admin_list_friend_links(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理端友情链接列表（按 id 正序，仅管理员）"""
    links = db.query(FriendLink).order_by(FriendLink.id.asc()).all()
    return FriendLinkListResponse(total=len(links), links=links)


@app.put("/api/admin/friend-links/{link_id}", response_model=FriendLinkResponse, tags=["友情链接"])
def update_friend_link(
    link_id: int,
    req: UpdateFriendLinkRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """更新友情链接（仅管理员，非 None 字段逐个更新）"""
    link = db.query(FriendLink).filter(FriendLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="友情链接不存在")
    if req.name is not None:
        link.name = req.name
    if req.url is not None:
        link.url = req.url
    if "description" in req.model_fields_set:
        link.description = req.description or None
    db.commit()
    db.refresh(link)
    return link


@app.delete("/api/admin/friend-links/{link_id}", response_model=MessageResponse, tags=["友情链接"])
def delete_friend_link(
    link_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """删除友情链接（仅管理员）"""
    link = db.query(FriendLink).filter(FriendLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="友情链接不存在")
    db.delete(link)
    db.commit()
    return MessageResponse(message="友情链接已删除")


# ============================================
# 站点设置 API
# ============================================

_DEFAULT_CONTACT_ITEMS = [
    {"label": "邮箱", "value": "jianghuxingxzhe@icloud.com", "description": "有任何问题，欢迎邮件联系"},
    {"label": "GitHub", "value": "https://github.com/fromtheendtothebeginning", "description": "从尽头到开始，Github 主页"},
]


@app.get("/api/site-settings", response_model=SiteSettingResponse, tags=["站点设置"])
def get_site_settings(db: Session = Depends(get_db)):
    """获取站点联系设置（首页"保持联系"区块，公开，无配置时返回默认项）"""
    setting = db.query(SiteSetting).first()
    if not setting:
        return SiteSettingResponse(email="", github_url="", contact_items=list(_DEFAULT_CONTACT_ITEMS))
    items = setting.contact_items or []
    if not items:
        # 旧数据兼容：由 email/github_url 生成默认两项
        items = [
            {"label": "邮箱", "value": setting.email or _DEFAULT_CONTACT_ITEMS[0]["value"]},
            {"label": "GitHub", "value": setting.github_url or _DEFAULT_CONTACT_ITEMS[1]["value"]},
        ]
    # 旧数据兼容：缺 type/icon 的联系项补默认值
    for it in items:
        it.setdefault("type", "link")
        it.setdefault("icon", "")
        it.setdefault("description", "")
    return SiteSettingResponse(email=setting.email or "", github_url=setting.github_url or "", contact_items=items)


@app.put("/api/admin/site-settings", response_model=SiteSettingResponse, tags=["站点设置"])
def update_site_settings(
    req: UpdateSiteSettingRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """更新站点联系设置（仅管理员，联系项为唯一数据源，邮箱/GitHub 兼容同步）"""
    setting = db.query(SiteSetting).first()
    if not setting:
        setting = SiteSetting(email="", github_url="", contact_items=list(_DEFAULT_CONTACT_ITEMS))
        db.add(setting)
    if "email" in req.model_fields_set:
        setting.email = req.email or ""
    if "github_url" in req.model_fields_set:
        setting.github_url = req.github_url or ""
    if "contact_items" in req.model_fields_set:
        setting.contact_items = [item.model_dump() for item in req.contact_items] if req.contact_items else []
        # 兼容同步：从联系项回写 email/github_url（label 匹配）
        for it in setting.contact_items:
            if it["label"] == "邮箱":
                setting.email = it["value"].replace("mailto:", "").strip()
            elif it["label"] == "GitHub":
                setting.github_url = it["value"].strip()
    db.commit()
    db.refresh(setting)
    return setting


# ============================================
# LeetCode 刷题量 & 公开榜单
# ============================================

LEETCODE_GRAPHQL = "https://leetcode.cn/graphql"
LEETCODE_QUERY = (
    "query userQuestionProgress($userSlug: String!) {"
    " userProfileUserQuestionProgress(userSlug: $userSlug) {"
    "  numAcceptedQuestions { difficulty count }"
    " } }"
)


def fetch_leetcode_progress(username: str):
    """调用 LeetCode 公开 GraphQL 拉取用户各难度已解题数。
    返回 (easy, medium, hard) 或 None（用户不存在）；网络/解析失败抛异常。"""
    body = json.dumps({
        "query": LEETCODE_QUERY,
        "variables": {"userSlug": username},
    }).encode()
    req = urllib.request.Request(
        LEETCODE_GRAPHQL, data=body,
        headers={
            "Content-Type": "application/json",
            "Referer": "https://leetcode.cn/u/" + urllib.parse.quote(username, safe=""),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) anticraft-leetcode-sync",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    inner = data.get("data") or {}
    nums = inner.get("userProfileUserQuestionProgress")
    if not nums or not nums.get("numAcceptedQuestions"):
        # 用户不存在（接口返回空数组 / null）
        return None
    counts = {"EASY": 0, "MEDIUM": 0, "HARD": 0}
    for item in nums["numAcceptedQuestions"]:
        counts[item.get("difficulty", "")] = int(item.get("count") or 0)
    return counts["EASY"], counts["MEDIUM"], counts["HARD"]


def leetcode_inc(binding) -> tuple:
    """8.13 起（绑定日）的刷题增量：当前题数 - 基线，各维度不为负"""
    return (
        max(0, binding.cur_easy - binding.base_easy),
        max(0, binding.cur_medium - binding.base_medium),
        max(0, binding.cur_hard - binding.base_hard),
    )


def leetcode_score(e: int, m: int, h: int, difficulty_mode: bool, serious_mode: bool = False, boost_mode: bool = False) -> float:
    """激励模式：初始 -100 分，简单 3 / 中等 6 / 困难 9；
    否则：简单 2 / 中等 4 / 困难 8，严肃模式简单不计分，困难模式减半"""
    if boost_mode:
        return -100.0 + e * 3 + m * 6 + h * 9
    e_score = 0 if serious_mode else e * 2
    score = e_score + m * 4 + h * 8
    return score / 2 if difficulty_mode else float(score)


def _leetcode_me_payload(binding) -> dict:
    e, m, h = leetcode_inc(binding)
    return {
        "bound": True,
        "leetcode_username": binding.leetcode_username,
        "difficulty_mode": bool(binding.difficulty_mode),
        "serious_mode": bool(binding.serious_mode),
        "boost_mode": bool(binding.boost_mode),
        "debug_mode": bool(binding.debug_mode),
        "base": {"easy": binding.base_easy, "medium": binding.base_medium, "hard": binding.base_hard},
        "cur": {"easy": binding.cur_easy, "medium": binding.cur_medium, "hard": binding.cur_hard},
        "inc": {"easy": e, "medium": m, "hard": h},
        "total_inc": e + m + h,
        "score": leetcode_score(e, m, h, bool(binding.difficulty_mode), bool(binding.serious_mode), bool(binding.boost_mode)),
        "updated_at": binding.updated_at,
        "leetcode_ok": True,
    }


@app.get("/api/leetcode/me", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_me(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    """获取当前用户的 LeetCode 绑定与刷题增量（实时同步）"""
    user_id = current_user.id
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if not binding:
        return LeetcodeMeResponse(bound=False)
    if not binding.debug_mode:
        try:
            prog = fetch_leetcode_progress(binding.leetcode_username)
            if prog is not None:
                binding.cur_easy, binding.cur_medium, binding.cur_hard = prog
                db.commit()
        except Exception:
            pass
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.put("/api/leetcode/me", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_bind(
    req: UpdateLeetcodeRequest,
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """绑定/改绑 LeetCode 账号（绑定时刻为 8.13 起算基线）"""
    user_id = current_user.id
    username = req.leetcode_username.strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名不能为空")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名无效，仅支持字母、数字、下划线等字符")
    try:
        prog = fetch_leetcode_progress(username)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无法连接 LeetCode，请稍后重试")
    if prog is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="LeetCode 用户不存在")
    existing = db.query(LeetcodeBinding).filter(
        LeetcodeBinding.leetcode_username == username,
        LeetcodeBinding.user_id != user_id,
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该 LeetCode 账号已被其他用户绑定")
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if binding:
        binding.leetcode_username = username
    else:
        binding = LeetcodeBinding(user_id=user_id, leetcode_username=username)
        db.add(binding)
    binding.base_easy, binding.base_medium, binding.base_hard = prog
    binding.cur_easy, binding.cur_medium, binding.cur_hard = prog
    db.commit()
    db.refresh(binding)
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.delete("/api/leetcode/me", response_model=MessageResponse, tags=["LeetCode"])
def leetcode_unbind(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    """解绑 LeetCode 账号"""
    user_id = current_user.id
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if binding:
        db.delete(binding)
        db.commit()
    return MessageResponse(message="已解绑")


def _enter_boost(binding) -> None:
    """进入激励模式：备份当前基线并清零刷题量（退出时恢复），并关闭困难/严肃（互斥）"""
    if binding.backup_base_easy is None:
        binding.backup_base_easy = binding.base_easy
        binding.backup_base_medium = binding.base_medium
        binding.backup_base_hard = binding.base_hard
    binding.base_easy = binding.cur_easy
    binding.base_medium = binding.cur_medium
    binding.base_hard = binding.cur_hard
    binding.boost_mode = True
    binding.difficulty_mode = False
    binding.serious_mode = False


def _exit_boost(binding) -> None:
    """退出激励模式：恢复备份的基线（若此前已进入）"""
    if not binding.boost_mode:
        return
    if binding.backup_base_easy is not None:
        binding.base_easy = binding.backup_base_easy
        binding.base_medium = binding.backup_base_medium
        binding.base_hard = binding.backup_base_hard
        binding.backup_base_easy = None
        binding.backup_base_medium = None
        binding.backup_base_hard = None
    binding.boost_mode = False


@app.put("/api/leetcode/me/mode", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_mode(
    req: UpdateLeetcodeModeRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """切换模式（激励与困难/严肃互斥；进入激励备份并清零刷题量，退出恢复）"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == user_id).first()
    if not binding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="尚未绑定 LeetCode 账号")
    # 三模式互斥：激励与困难/严肃不可共存
    if req.boost_mode is True:
        _enter_boost(binding)
    if req.difficulty_mode is True:
        _exit_boost(binding)
        binding.difficulty_mode = True
    if req.serious_mode is True:
        _exit_boost(binding)
        binding.serious_mode = True
    if req.boost_mode is False:
        _exit_boost(binding)
    if req.difficulty_mode is False:
        binding.difficulty_mode = False
    if req.serious_mode is False:
        binding.serious_mode = False
    db.commit()
    db.refresh(binding)
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.put("/api/leetcode/me/debug", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_debug_toggle(
    req: UpdateLeetcodeDebugRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员调试模式：开启时不再读取 LeetCode，备份当前数据并手动调整；关闭时恢复备份数据"""
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == _admin.id).first()
    if not binding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="尚未绑定 LeetCode 账号")
    if req.debug_mode and not binding.debug_mode:
        # 开启：备份当前 base/cur
        binding.debug_backup_base_easy = binding.base_easy
        binding.debug_backup_base_medium = binding.base_medium
        binding.debug_backup_base_hard = binding.base_hard
        binding.debug_backup_cur_easy = binding.cur_easy
        binding.debug_backup_cur_medium = binding.cur_medium
        binding.debug_backup_cur_hard = binding.cur_hard
        binding.debug_mode = True
    elif not req.debug_mode and binding.debug_mode:
        # 关闭：保留调试期间手动设置的增量（同步真实值后固化到 base），不再覆盖丢弃
        if binding.debug_backup_base_easy is not None:
            try:
                real = fetch_leetcode_progress(binding.leetcode_username)
            except Exception:
                real = None
            if real is not None:
                inc_e = max(0, binding.cur_easy - binding.debug_backup_base_easy)
                inc_m = max(0, binding.cur_medium - binding.debug_backup_base_medium)
                inc_h = max(0, binding.cur_hard - binding.debug_backup_base_hard)
                binding.cur_easy, binding.cur_medium, binding.cur_hard = real
                binding.base_easy = max(0, real[0] - inc_e)
                binding.base_medium = max(0, real[1] - inc_m)
                binding.base_hard = max(0, real[2] - inc_h)
            # 同步失败：保留当前 cur/base 数据
        binding.debug_backup_base_easy = None
        binding.debug_backup_base_medium = None
        binding.debug_backup_base_hard = None
        binding.debug_backup_cur_easy = None
        binding.debug_backup_cur_medium = None
        binding.debug_backup_cur_hard = None
        binding.debug_mode = False
    db.commit()
    db.refresh(binding)
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.put("/api/leetcode/me/debug/set", response_model=LeetcodeMeResponse, tags=["LeetCode"])
def leetcode_debug_set(
    req: LeetcodeDebugSetRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """调试模式下手动设置刷题量（增量 = 输入值，基于调试开启时保存的基线）"""
    binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.user_id == _admin.id).first()
    if not binding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="尚未绑定 LeetCode 账号")
    if not binding.debug_mode:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="调试模式未开启")
    base_e = binding.debug_backup_base_easy if binding.debug_backup_base_easy is not None else binding.base_easy
    base_m = binding.debug_backup_base_medium if binding.debug_backup_base_medium is not None else binding.base_medium
    base_h = binding.debug_backup_base_hard if binding.debug_backup_base_hard is not None else binding.base_hard
    binding.cur_easy = base_e + max(0, req.easy)
    binding.cur_medium = base_m + max(0, req.medium)
    binding.cur_hard = base_h + max(0, req.hard)
    db.commit()
    db.refresh(binding)
    return LeetcodeMeResponse(**_leetcode_me_payload(binding))


@app.get("/api/leetcode/leaderboard", response_model=LeetcodeBoardResponse, tags=["LeetCode"])
def leetcode_leaderboard(db: Session = Depends(get_db)):
    """公开榜单：从 8.13 起的刷题增量，按得分排序（缓存数据，不实时同步）"""
    rows = (
        db.query(LeetcodeBinding)
        .options(joinedload(LeetcodeBinding.user))
        .order_by(LeetcodeBinding.created_at.asc())
        .all()
    )
    users = []
    for b in rows:
        e, m, h = leetcode_inc(b)
        users.append({
            "user_id": b.user_id,
            "nickname": b.user.nickname if b.user else None,
            "username": b.user.username if b.user else "已注销",
            "avatar_url": b.user.avatar_url if b.user else None,
            "leetcode_username": b.leetcode_username,
            "difficulty_mode": bool(b.difficulty_mode),
            "serious_mode": bool(b.serious_mode),
            "boost_mode": bool(b.boost_mode),
            "debug_mode": bool(b.debug_mode),
            "easy": e,
            "medium": m,
            "hard": h,
            "total": e + m + h,
            "score": leetcode_score(e, m, h, bool(b.difficulty_mode), bool(b.serious_mode), bool(b.boost_mode)),
            "updated_at": b.updated_at,
        })
    users.sort(key=lambda u: (-u["score"], -u["total"], u["user_id"]))
    return LeetcodeBoardResponse(users=users, generated_at=datetime.now(timezone.utc))


def _sync_leetcode_one(bid: int, username: str) -> bool:
    """同步单个绑定（独立 Session，供并发刷新使用）"""
    from database import SessionLocal
    db = SessionLocal()
    try:
        binding = db.query(LeetcodeBinding).filter(LeetcodeBinding.id == bid).first()
        if not binding or binding.debug_mode:
            return False
        prog = fetch_leetcode_progress(username)
        if prog is None:
            return False
        binding.cur_easy, binding.cur_medium, binding.cur_hard = prog
        db.commit()
        return True
    except Exception:
        db.rollback()
        return False
    finally:
        db.close()


@app.post("/api/leetcode/refresh", response_model=LeetcodeRefreshResponse, tags=["LeetCode"])
def leetcode_refresh(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    """同步所有绑定用户的 LeetCode 数据（需登录，并发重新请求，失败者保留旧值）"""
    bindings = db.query(LeetcodeBinding).all()
    if not bindings:
        return LeetcodeRefreshResponse(synced=0, total=0)
    tasks = [(b.id, b.leetcode_username) for b in bindings]
    synced = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = pool.map(lambda t: _sync_leetcode_one(*t), tasks)
        synced = sum(1 for ok in results if ok)
    return LeetcodeRefreshResponse(synced=synced, total=len(bindings))


# ============================================
# LeetCode 心跳同步（后台线程，每分钟刷新所有绑定用户数据）
# ============================================

_heartbeat_lock = threading.Lock()
_heartbeat_last = None  # 最近一次心跳完成时间（ISO）
_heartbeat_last_count = 0  # 最近一次成功同步数
_heartbeat_stop = threading.Event()


def _sync_all_heartbeat():
    """同步所有非调试绑定用户（独立会话，失败跳过）"""
    from database import SessionLocal
    db = SessionLocal()
    try:
        bindings = db.query(LeetcodeBinding).filter(LeetcodeBinding.debug_mode.is_(False)).all()
        tasks = [(b.id, b.leetcode_username) for b in bindings]
    finally:
        db.close()
    if not tasks:
        return 0
    synced = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = pool.map(lambda t: _sync_leetcode_one(*t), tasks)
        synced = sum(1 for ok in results if ok)
    return synced


def _heartbeat_loop():
    """后台循环：启动后立即同步一次，之后每分钟一次；防止上一次未完成时重叠"""
    global _heartbeat_last, _heartbeat_last_count
    while not _heartbeat_stop.wait(60):
        if not _heartbeat_lock.acquire(blocking=False):
            continue  # 上一次同步仍在进行，跳过本次
        try:
            _heartbeat_last_count = _sync_all_heartbeat()
            _heartbeat_last = datetime.now(timezone.utc).isoformat()
            _log(f"heartbeat sync done: {_heartbeat_last_count} users")
        except Exception:
            _heartbeat_last_count = 0
        finally:
            _heartbeat_lock.release()


def _start_heartbeat():
    t = threading.Thread(target=_heartbeat_loop, daemon=True, name="leetcode-heartbeat")
    t.start()


@app.get("/api/leetcode/heartbeat", tags=["LeetCode"])
def leetcode_heartbeat_status(_admin: User = Depends(require_admin)):
    """心跳状态（最近同步时间与成功数，仅管理员）"""
    return {
        "enabled": True,
        "interval": 60,
        "last_run": _heartbeat_last,
        "last_synced": _heartbeat_last_count,
    }


# ============================================
# 视频工具 API（视频解析与下载，需登录）
# ============================================

def _require_http_url(url: str) -> str:
    """校验工具 URL：必须以 http:// 或 https:// 开头，且非内网地址（防 SSRF/任意文件读取）"""
    if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL 必须为 http:// 或 https:// 开头",
        )
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL 无效")
    lowered = host.lower().rstrip(".")
    if lowered in ("localhost", "localhost.localdomain") or lowered.endswith((".localhost", ".local")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许访问内网地址")
    try:
        ip = ipaddress.ip_address(lowered)
        if not ip.is_global:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许访问内网地址")
    except ValueError:
        try:
            resolved = socket.gethostbyname(host)
            if not ipaddress.ip_address(resolved).is_global:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许访问内网地址")
        except HTTPException:
            raise
        except OSError:
            pass  # 域名解析失败交由 yt-dlp 处理
    return url


_THUMB_ALLOW_HOSTS = ("hdslb.com", "bilibili.com", "ytimg.com", "youtube.com", "akamaized.net", "img.youtube.com", "youtu.be")


def _thumb_host_allowed(host: str) -> bool:
    return any(host == h or host.endswith("." + h) for h in _THUMB_ALLOW_HOSTS)


@app.get("/api/tools/video/info", tags=["工具"])
def video_info(
    url: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """解析视频信息（不下载，需登录）"""
    _require_http_url(url)
    _log(f"video/info by {current_user.username} : {url[:80]}")
    try:
        info = tools.extract_video_info(url)
    except Exception:
        _log("video/info FAILED: " + url[:80])
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法解析该视频链接",
        )
    _log(f"video/info OK: 「{info.get('title', '')[:40]}」 {info.get('duration', 0)}s")
    return {"ok": True, "info": info}


@app.get("/api/tools/video/download", tags=["工具"])
def video_download(
    url: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """下载视频为 mp4（需登录，单并发；响应完成后自动清理临时文件）"""
    _require_http_url(url)
    try:
        path, filename = tools.download_video(url)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="下载失败，请稍后重试",
        )
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=filename,
        background=BackgroundTask(tools.cleanup_download_dir, os.path.dirname(path)),
    )


# 下载任务（后端 yt-dlp 实时进度 → 前端轮询）
_dl_lock = threading.Lock()
_dl_tasks = {}  # task_id -> {progress, status, path, filename, error}


@app.post("/api/tools/video/download-task", tags=["工具"])
def video_download_task(
    req: dict,
    current_user: User = Depends(get_current_user_obj),
):
    """创建下载任务，后台 yt-dlp 下载并实时更新进度（需登录）
    mode: merged/video_only/audio_only/separate（见 tools.download_video）"""
    url = (req.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入视频链接")
    mode = (req.get("mode") or "merged").strip()
    if mode not in ("merged", "video_only", "audio_only", "separate"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未知的下载模式")
    _require_http_url(url)
    task_id = secrets.token_urlsafe(16)
    task = {"progress": 0, "status": "downloading", "path": None, "filename": None, "files": None, "error": None}
    with _dl_lock:
        _dl_tasks[task_id] = task
    _log(f"download-task created by {current_user.username} [{mode}] : {url[:60]} -> {task_id[:8]}")

    def _run():
        try:
            # progress 只增不减：yt-dlp 对音视频分离的源会分多路下载（视频流+音频流），
            # 每路的 progress_hooks 独立 0-100，直接覆盖会让进度条走完一遍又从 0 走一遍
            results = tools.download_video(
                url,
                mode=mode,
                progress_cb=lambda p: task.__setitem__("progress", max(task["progress"], p)),
            )
            task["files"] = results  # [(path, filename), ...]
            task["path"] = results[0][0]
            task["filename"] = results[0][1]
            task["status"] = "done"
            _log(f"download-task done [{mode}]: {len(results)} file(s)")
        except Exception as exc:
            task["status"] = "failed"
            task["error"] = str(exc)[:200]
            _log(f"download-task FAILED [{mode}]: {str(exc)[:120]}")

    threading.Thread(target=_run, daemon=True).start()
    return {"task_id": task_id}


@app.get("/api/tools/video/download-progress", tags=["工具"])
def video_download_progress(
    task_id: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """查询下载任务进度（前端轮询）"""
    task = _dl_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return {"progress": task["progress"], "status": task["status"], "error": task.get("error")}


@app.get("/api/tools/video/download-file", tags=["工具"])
def video_download_file(
    task_id: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """下载任务完成后获取文件（需登录）。多文件（separate 模式）打包为 zip 返回。"""
    task = _dl_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if task["status"] != "done":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="任务尚未完成")
    files = task["files"] or [(task["path"], task["filename"])]
    with _dl_lock:
        _dl_tasks.pop(task_id, None)

    if len(files) == 1:
        path, filename = files[0]
        media_type = "video/mp4" if filename.lower().endswith((".mp4", ".mkv", ".webm", ".m4v")) else (
            "audio/mpeg" if filename.lower().endswith((".mp3", ".m4a")) else "application/octet-stream"
        )
        return FileResponse(
            path,
            media_type=media_type,
            filename=filename,
            background=BackgroundTask(tools.cleanup_download_dir, os.path.dirname(path)),
        )

    # 多文件：打包 zip（不随响应删除，交给前端下载后由清理任务处理）
    import zipfile
    zpath = os.path.join(os.path.dirname(files[0][0]), "download.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, filename in files:
            zf.write(path, filename)
    return FileResponse(
        zpath,
        media_type="application/zip",
        filename="download.zip",
        background=BackgroundTask(tools.cleanup_download_dir, os.path.dirname(zpath)),
    )


@app.get("/api/tools/thumb", tags=["工具"])
def tool_thumb(
    url: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """代理视频封面图（绕过防盗链/临时 URL 过期），仅允许图片 CDN 域名，需登录"""
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if not _thumb_host_allowed(host):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许的图片域名")
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片 URL 无效")
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://www.bilibili.com/",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "image/jpeg")
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片获取失败")
    return Response(content=data, media_type=ctype)


# ============================================
# 启动入口
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=os.getenv("HOST", "127.0.0.1"), port=8000, reload=False)
