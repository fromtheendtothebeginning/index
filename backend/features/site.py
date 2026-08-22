# features/site.py — 友情链接 + 站点设置

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from deps import require_admin
from models import FriendLink, SiteSetting, User
from schemas import (
    FriendLinkListResponse, FriendLinkRequest, FriendLinkResponse, MessageResponse,
    SiteSettingResponse, UpdateFriendLinkRequest, UpdateSiteSettingRequest,
)

router = APIRouter()


@router.get("/api/friend-links", response_model=FriendLinkListResponse, tags=["友情链接"])
def list_friend_links(db: Session = Depends(get_db)):
    """获取友情链接列表（按 id 正序，公开）"""
    links = db.query(FriendLink).order_by(FriendLink.id.asc()).all()
    return FriendLinkListResponse(total=len(links), links=links)


@router.post("/api/admin/friend-links", response_model=FriendLinkResponse, status_code=status.HTTP_201_CREATED, tags=["友情链接"])
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


@router.get("/api/admin/friend-links", response_model=FriendLinkListResponse, tags=["友情链接"])
def admin_list_friend_links(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理端友情链接列表（按 id 正序，仅管理员）"""
    links = db.query(FriendLink).order_by(FriendLink.id.asc()).all()
    return FriendLinkListResponse(total=len(links), links=links)


@router.put("/api/admin/friend-links/{link_id}", response_model=FriendLinkResponse, tags=["友情链接"])
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


@router.delete("/api/admin/friend-links/{link_id}", response_model=MessageResponse, tags=["友情链接"])
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


@router.get("/api/site-settings", response_model=SiteSettingResponse, tags=["站点设置"])
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


@router.put("/api/admin/site-settings", response_model=SiteSettingResponse, tags=["站点设置"])
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
