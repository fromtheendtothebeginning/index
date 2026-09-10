# features/ai_settings_api.py — AI 设置（多 Key 管理 + 动态模型 + 收藏 + 当前选择）

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

import aisettings

from constants import SPEECH_MODEL_PATTERNS, VISION_MODEL_PATTERNS
from database import get_db
from deps import get_current_user_obj
from models import AiFavorite, AiKey, AiModel, AiSetting, User
from schemas import (
    AiCustomModelRequest, AiCustomModelResponse,
    AiFavoriteToggleRequest, AiFavoriteToggleResponse,
    AiKeyResponse, AiKeysResponse, AiModelsResponse,
    AiSettingsResponse, AiSettingsTestRequest, AiSettingsTestResponse,
    CreateAiKeyRequest, MessageResponse, UpdateAiKeyRequest, UpdateAiSettingsRequest,
)

router = APIRouter()


# schemas.py 本次不动：识图思考深度字段在 API 层用子类扩展（其余字段/校验全部继承）
class AiSettingsResponseVision(AiSettingsResponse):
    """AI 设置响应 + 识图模型思考深度（空串=跟随模型默认）"""
    vision_thinking: str = ""


class UpdateAiSettingsRequestVision(UpdateAiSettingsRequest):
    """AI 设置请求 + 识图模型思考深度（None=不改）"""
    vision_thinking: Optional[str] = None


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

@router.get("/api/user/ai-settings", response_model=AiSettingsResponseVision, tags=["AI 设置"])
def get_ai_settings(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    s = _get_or_create_ai_setting(db, current_user.id)
    return AiSettingsResponseVision(
        key_id=s.key_id,
        model=s.model or "",
        thinking_level=s.thinking_level,
        temperature=float(s.temperature),
        top_k=int(s.top_k),
        vision_key_id=s.vision_key_id,
        vision_model=s.vision_model or "",
        vision_thinking=s.vision_thinking or "",
        speech_key_id=s.speech_key_id,
        speech_model=s.speech_model or "",
        updated_at=s.updated_at,
    )


@router.put("/api/user/ai-settings", response_model=AiSettingsResponseVision, tags=["AI 设置"])
def update_ai_settings(
    req: UpdateAiSettingsRequestVision,
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
        # 识图 / 语音模型配置（独立于主 Key，0=清除）
        if req.vision_key_id is not None:
            s.vision_key_id = None if req.vision_key_id == 0 else _get_key(db, req.vision_key_id, current_user.id).id
        if req.vision_model is not None:
            s.vision_model = (req.vision_model or "").strip()[:100]
        if req.vision_thinking is not None:
            s.vision_thinking = (req.vision_thinking or "")[:10]
        if req.speech_key_id is not None:
            s.speech_key_id = None if req.speech_key_id == 0 else _get_key(db, req.speech_key_id, current_user.id).id
        if req.speech_model is not None:
            s.speech_model = (req.speech_model or "").strip()[:100]

    db.commit()
    db.refresh(s)
    return AiSettingsResponseVision(
        key_id=s.key_id, model=s.model or "", thinking_level=s.thinking_level,
        temperature=float(s.temperature), top_k=int(s.top_k),
        vision_key_id=s.vision_key_id, vision_model=s.vision_model or "",
        vision_thinking=s.vision_thinking or "",
        speech_key_id=s.speech_key_id, speech_model=s.speech_model or "",
        updated_at=s.updated_at,
    )


# ── 多 Key 管理 ──

@router.get("/api/user/ai-keys", response_model=AiKeysResponse, tags=["AI 设置"])
def list_ai_keys(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    keys = db.query(AiKey).filter(AiKey.user_id == current_user.id).order_by(AiKey.id).all()
    return AiKeysResponse(keys=[_ai_key_response(k) for k in keys])


@router.post("/api/user/ai-keys", response_model=AiKeyResponse, status_code=status.HTTP_201_CREATED, tags=["AI 设置"])
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


@router.put("/api/user/ai-keys/{key_id}", response_model=AiKeyResponse, tags=["AI 设置"])
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


@router.delete("/api/user/ai-keys/{key_id}", response_model=MessageResponse, tags=["AI 设置"])
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


@router.get("/api/user/ai-keys/{key_id}/models", response_model=AiModelsResponse, tags=["AI 设置"])
def list_ai_key_models(
    key_id: int,
    capability: str = Query(None, description="可选：vision/speech 只返回支持该能力的模型"),
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """用该 Key 调提供商 /models 列出可用模型（动态）；capability 按模型能力过滤"""
    k = _get_key(db, key_id, current_user.id)
    api_key = aisettings.decrypt_secret(k.api_key_enc) if k.api_key_enc else None
    if not api_key:
        return AiModelsResponse(provider=k.provider, models=[], error="该 Key 无有效凭证")
    ok, models, error = aisettings.list_models(k.provider, api_key, k.custom_base_url)
    if capability in ("vision", "speech"):
        patterns = VISION_MODEL_PATTERNS if capability == "vision" else SPEECH_MODEL_PATTERNS
        low = [p.lower() for p in patterns]
        models = [m for m in models if any(p in m.lower() for p in low)]
    return AiModelsResponse(provider=k.provider, models=models, error=None if ok else error)


# ── 收藏模型 ──

@router.get("/api/user/ai-favorites", response_model=AiFavoriteToggleResponse, tags=["AI 设置"])
def list_ai_favorites(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    favs = db.query(AiFavorite).filter(AiFavorite.user_id == current_user.id).all()
    return AiFavoriteToggleResponse(favorited=False, favorites=[f.model for f in favs])


@router.post("/api/user/ai-favorites/toggle", response_model=AiFavoriteToggleResponse, tags=["AI 设置"])
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

@router.get("/api/user/ai-models", response_model=AiCustomModelResponse, tags=["AI 设置"])
def list_ai_models(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    rows = db.query(AiModel).filter(AiModel.user_id == current_user.id).order_by(AiModel.id).all()
    return AiCustomModelResponse(models=[r.model for r in rows])


@router.post("/api/user/ai-models", response_model=AiCustomModelResponse, tags=["AI 设置"])
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


@router.delete("/api/user/ai-models", response_model=AiCustomModelResponse, tags=["AI 设置"])
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

@router.post("/api/user/ai-settings/test", response_model=AiSettingsTestResponse, tags=["AI 设置"])
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
