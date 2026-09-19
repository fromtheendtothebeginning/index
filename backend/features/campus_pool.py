# features/campus_pool.py — 共享 VPN 会话池：管理端 CRUD + DB 同步线程 + 站长识图模型解析
# 池子只服务公开数据（活动看板免配置查看）；个人数据（分数/成绩/校园卡）一律走用户自己的会话。

import threading
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession
from typing import Optional

import aisettings
from campus.pool import pool_key
from database import SessionLocal, get_db
from deps import _log, _mask_sid, require_admin
from models import CampusPoolAccount, User

router = APIRouter()

SYNC_SECONDS = 60


def resolve_pool_vision():
    """共享会话的 CAS 验证码用站长（第一个 admin）配置的识图模型识别。"""
    import features.campus_service as cs

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").order_by(User.id.asc()).first()
        if not admin:
            return None
        return cs._resolve_vision_model(admin.id, db)
    finally:
        db.close()


def _sync_once():
    """把 DB 里的账号全集喂给 PoolManager（创建/停用会话）。"""
    import features.campus_service as cs

    m = cs._get_managers()
    pool = m.get("pool")
    if pool is None:
        return
    db = SessionLocal()
    try:
        rows = db.query(CampusPoolAccount).all()
    finally:
        db.close()
    accounts = {}
    for r in rows:
        key = pool_key(r.id)
        if r.enabled:
            accounts[key] = {"id": r.id, "student_id": r.student_id, "label": r.label,
                             "password": aisettings.decrypt_secret(r.password_enc) or "",
                             "enabled": True}
        else:
            accounts[key] = {"id": r.id, "enabled": False}
    pool.set_accounts(accounts)


def _sync_loop():
    while True:
        try:
            _sync_once()
        except Exception as e:
            _log("campus pool sync error: %s" % str(e)[:200])
        time.sleep(SYNC_SECONDS)


threading.Thread(target=_sync_loop, daemon=True, name="campus-pool-sync").start()


# ============================================================
# 管理端 CRUD（仅 admin）
# ============================================================

class PoolAccountCreate(BaseModel):
    student_id: str
    password: str
    label: str = ""


class PoolAccountUpdate(BaseModel):
    label: Optional[str] = None
    password: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/api/campus/pool", tags=["校园服务"])
def pool_list(current_user: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    import features.campus_service as cs

    m = cs._get_managers()
    pool = m.get("pool")
    active = pool.active_key() if pool else None
    yielded = bool(pool.yielded) if pool else False
    accounts = []
    for r in db.query(CampusPoolAccount).order_by(CampusPoolAccount.id.asc()).all():
        st = pool.status_of(r.id) if pool else {"status": "none", "error": None, "cas_ready": False}
        accounts.append({
            "id": r.id,
            "student_id_masked": _mask_sid(r.student_id),
            "label": r.label,
            "enabled": bool(r.enabled),
            "active": pool_key(r.id) == active,
            **st,
        })
    return {"accounts": accounts, "vision_ready": resolve_pool_vision() is not None, "yielded": yielded}


@router.post("/api/campus/pool", tags=["校园服务"])
def pool_create(req: PoolAccountCreate, current_user: User = Depends(require_admin)):
    sid = (req.student_id or "").strip()
    if not sid or not req.password:
        raise HTTPException(status_code=400, detail="学号和密码不能为空")
    row = CampusPoolAccount(student_id=sid, password_enc=aisettings.encrypt_secret(req.password),
                            label=(req.label or "").strip()[:50], enabled=True)
    db = SessionLocal()
    try:
        db.add(row)
        db.commit()
        account_id = row.id
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="该学号已在共享会话池中")
    finally:
        db.close()
    _sync_once()
    return {"ok": True, "id": account_id}


@router.put("/api/campus/pool/{account_id}", tags=["校园服务"])
def pool_update(account_id: int, req: PoolAccountUpdate, current_user: User = Depends(require_admin)):
    db = SessionLocal()
    try:
        row = db.query(CampusPoolAccount).filter(CampusPoolAccount.id == account_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="账号不存在")
        if req.label is not None:
            row.label = req.label.strip()[:50]
        if req.password:
            row.password_enc = aisettings.encrypt_secret(req.password)
        if req.enabled is not None:
            row.enabled = bool(req.enabled)
        db.commit()
    finally:
        db.close()
    _sync_once()
    return {"ok": True}


@router.delete("/api/campus/pool/{account_id}", tags=["校园服务"])
def pool_delete(account_id: int, current_user: User = Depends(require_admin)):
    db = SessionLocal()
    try:
        row = db.query(CampusPoolAccount).filter(CampusPoolAccount.id == account_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="账号不存在")
        db.delete(row)
        db.commit()
    finally:
        db.close()
    _sync_once()
    return {"ok": True}
