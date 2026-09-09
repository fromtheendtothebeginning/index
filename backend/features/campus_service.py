# features/campus_service.py — 校园服务工具（EasyConnect VPN + 第二课堂分/成绩/校园卡动态码）
# 移植自 SCHOOLALY（独立 FastAPI 服务）并融合 anticraft：
#   - 凭据存 campus_creds 表（密码用 aisettings 加密），每用户自己填写
#   - VPN 会话按 user_id 维度单例（backend/campus/sessions.SessionManager）
#   - 查询客户端 backend/campus/dekt.DektClient，走该用户容器 socks 隧道
# 电费相关（openservice/SM4）本次不移植。

import base64
import json
import threading
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session as OrmSession

import aisettings
from database import get_db
from deps import _log, get_current_user_obj, require_admin
from models import AiKey, AiSetting, CampusCred, ElectricityRecord, User

router = APIRouter()

# ============================================================
# 单例（进程内）：docker 不可用时标记 unavailable，接口返回 503 提示
# ============================================================
_singletons = None
_singletons_lock = threading.Lock()


def _get_managers():
    global _singletons
    with _singletons_lock:
        if _singletons is None:
            try:
                from campus.config import Config
                from campus.dekt import DektManager
                from campus.docker_mgr import DockerManager
                from campus.sessions import SessionManager

                cfg = Config()
                docker = DockerManager(cfg)
                docker.cleanup_orphans()
                sessions = SessionManager(cfg, docker)
                dekt = DektManager(cfg)
                _singletons = {"cfg": cfg, "docker": docker, "sessions": sessions, "dekt": dekt}
            except Exception as e:
                # 含依赖缺失（如 docker 包未装）与 Docker 守护进程不可达
                _log(f"campus init failed: {type(e).__name__}: {str(e)[:200]}")
                _singletons = {"error": f"{type(e).__name__}: {str(e)[:250]}"}
    return _singletons


def _mgrs():
    m = _get_managers()
    if "error" in m:
        raise HTTPException(status_code=503, detail="校园服务未就绪（Docker 不可用）：" + m["error"])
    return m


# ============================================================
# 凭据
# ============================================================

class CredSaveRequest(BaseModel):
    student_id: str = ""
    real_name: str = ""
    vpn_password: str = ""
    pay_password: str = ""
    auto_captcha: bool = False
    dorm: str = ""


def _mask_sid(sid: str) -> str:
    if len(sid) <= 4:
        return "*" * len(sid)
    return sid[:2] + "*" * (len(sid) - 4) + sid[-2:]


@router.get("/api/campus/cred", tags=["校园服务"])
def campus_cred_get(current_user: User = Depends(get_current_user_obj), db: OrmSession = Depends(get_db)):
    c = db.query(CampusCred).filter(CampusCred.user_id == current_user.id).first()
    if not c or not c.student_id:
        return {"configured": False}
    return {
        "configured": True,
        "student_id": c.student_id,
        "student_id_masked": _mask_sid(c.student_id),
        "real_name": c.real_name,
        "has_pay_password": bool(c.pay_password_enc),
        "auto_captcha": bool(c.auto_captcha),
        "dorm": c.dorm or "",
    }


@router.put("/api/campus/cred", tags=["校园服务"])
def campus_cred_save(req: CredSaveRequest, current_user: User = Depends(get_current_user_obj),
                     db: OrmSession = Depends(get_db)):
    student_id = (req.student_id or "").strip()
    real_name = (req.real_name or "").strip()
    vpn_password = req.vpn_password or ""
    c = db.query(CampusCred).filter(CampusCred.user_id == current_user.id).first()
    # 首次配置必须填学号+VPN 密码；已有配置时可留空（保留旧值，只改其他字段）
    if not c:
        if not student_id or not vpn_password:
            raise HTTPException(status_code=400, detail="首次配置需填写学号和 VPN 密码")
        c = CampusCred(user_id=current_user.id)
        db.add(c)
    elif not student_id:
        raise HTTPException(status_code=400, detail="学号不能为空")
    c.student_id = student_id
    if real_name:
        c.real_name = real_name
    if vpn_password:
        c.vpn_password_enc = aisettings.encrypt_secret(vpn_password)
    if req.pay_password:
        c.pay_password_enc = aisettings.encrypt_secret(req.pay_password)
    c.auto_captcha = bool(req.auto_captcha)
    if req.dorm is not None:
        c.dorm = req.dorm.strip()
    db.commit()
    return {"ok": True}


def _load_cred(current_user, db) -> CampusCred:
    c = db.query(CampusCred).filter(CampusCred.user_id == current_user.id).first()
    if not c or not c.student_id:
        raise HTTPException(status_code=400, detail="尚未填写校园服务凭据，请到「我的 → 校园服务」填写")
    return c


def _decrypt_or_400(blob):
    plain = aisettings.decrypt_secret(blob) if blob else ""
    if not plain:
        raise HTTPException(status_code=400, detail="凭据解密失败，请重新填写")
    return plain


# ============================================================
# VPN 会话（全局单会话：管理员连接，所有用户共用）
# ============================================================

def _session_payload(sess, request=None) -> dict:
    if sess is None:
        return {"connected": False, "status": "none"}
    return {
        "connected": sess.status == "connected",
        "status": sess.status,
        "error": sess.error,
        "student_id_masked": sess.student_id_masked,
        "socks_port": sess.socks_port,
        "http_port": sess.http_port,
        # 对外展示用 display_host（公网域名/IP）；sess.proxy_host 是后端连接用的容器 IP
        "host": getattr(sess, "display_host", None) or getattr(sess, "proxy_host", "127.0.0.1"),
    }


@router.post("/api/campus/connect", tags=["校园服务"])
def campus_connect(request: Request, current_user: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    """管理员连接校园网 VPN（全局共享，所有用户共用该代理）"""
    m = _mgrs()
    c = _load_cred(current_user, db)
    vpn_pwd = _decrypt_or_400(c.vpn_password_enc)
    try:
        m["sessions"].create(c.student_id, vpn_pwd)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _session_payload(m["sessions"].get(), request)


@router.get("/api/campus/status", tags=["校园服务"])
def campus_status(request: Request, current_user: User = Depends(get_current_user_obj)):
    """所有登录用户可查看共享 VPN 状态与代理地址"""
    m = _mgrs()
    return _session_payload(m["sessions"].get(), request)


@router.post("/api/campus/disconnect", tags=["校园服务"])
def campus_disconnect(current_user: User = Depends(require_admin)):
    """管理员断开校园网 VPN"""
    m = _mgrs()
    m["sessions"].disconnect()
    return {"ok": True}


# ============================================================
# 定时自愈：整点检查代理，未连接则用管理员凭据自动连接
# ============================================================

def auto_connect_vpn():
    """检查共享 VPN 会话；未连接/已失败时用管理员的校园服务凭据自动重连。

    供 main.py 的整点调度线程调用（部署到服务器后同样生效）。
    """
    m = _get_managers()
    if "error" in m:
        _log("[vpn-auto] 跳过：Docker 不可用 - " + m["error"][:150])
        return
    sess = m["sessions"].get()
    if sess and sess.status in ("connected", "creating", "connecting"):
        _log(f"[vpn-auto] 无需处理，当前状态={sess.status}")
        return

    from database import SessionLocal
    db = SessionLocal()
    try:
        # 取第一个配了 VPN 密码的管理员凭据
        cred = (
            db.query(CampusCred)
            .join(User, User.id == CampusCred.user_id)
            .filter(User.role == "admin")
            .filter(CampusCred.vpn_password_enc.isnot(None))
            .filter(CampusCred.student_id != "")
            .first()
        )
        if not cred:
            _log("[vpn-auto] 跳过：没有可用的管理员校园服务凭据")
            return
        vpn_pwd = aisettings.decrypt_secret(cred.vpn_password_enc)
        if not vpn_pwd:
            _log("[vpn-auto] 跳过：管理员 VPN 密码解密失败")
            return
        _log(f"[vpn-auto] 发起连接，账号={cred.student_id}")
        m["sessions"].create(cred.student_id, vpn_pwd)
    except Exception as e:
        _log(f"[vpn-auto] 连接失败: {str(e)[:200]}")
    finally:
        db.close()


# ============================================================
# 校园查询（score / grades / ecard）
# ============================================================

def _connected_client(current_user, db):
    """返回 (session, dekt_client)；未连接/凭据缺失时抛 4xx"""
    m = _mgrs()
    sess = m["sessions"].get()
    if not sess or sess.status != "connected":
        raise HTTPException(status_code=400, detail="校园网未连接，请联系管理员连接 VPN")
    c = _load_cred(current_user, db)
    # 教务/学工登录用会话内密码（连接时已解密持有）
    return sess, m["dekt"].get(current_user.id, sess), c


# ============================================================
# AI 自动验证码识别
# ============================================================

def _resolve_vision_model(user_id, db):
    """查找用户配置的识图模型（key_id + model + 明文 key），无配置返回 None"""
    s = db.query(AiSetting).filter(AiSetting.user_id == user_id).first()
    if not s or not s.vision_key_id or not s.vision_model:
        return None
    key = db.query(AiKey).filter(AiKey.id == s.vision_key_id, AiKey.user_id == user_id).first()
    if not key or not key.api_key_enc:
        return None
    api_key = aisettings.decrypt_secret(key.api_key_enc)
    if not api_key:
        return None
    provider = key.provider or "deepseek"
    base_url = key.custom_base_url or ""
    return {"provider": provider, "api_key": api_key, "model": s.vision_model, "base_url": base_url}


def _ai_solve_captcha(captcha_b64, vision_info, timeout=30):
    """调用识图模型识别验证码图片，返回文字或 None"""
    provider = vision_info["provider"]
    api_key = vision_info["api_key"]
    model = vision_info["model"]
    base_url = vision_info["base_url"]

    if not base_url:
        # 从 provider 默认 base_url 取
        from utils import aiProviders as _aip
        p = _aip.get_provider(provider)
        base_url = p.get("base_url", "") if p else ""
    base_url = base_url.rstrip("/")

    # 构造 vision chat 请求（openai 兼容格式）
    url = f"{base_url}/chat/completions"
    if provider == "anthropic":
        # anthropic 格式：messages content 带 image 类型
        payload = {
            "model": model,
            "max_tokens": 100,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": captcha_b64}},
                    {"type": "text", "text": "请识别图片中的验证码文字，只返回纯文字内容，不要任何解释或其他内容。"}
                ]
            }]
        }
        headers = aisettings._build_headers("anthropic", api_key)
    else:
        # openai 兼容格式
        payload = {
            "model": model,
            "max_tokens": 100,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "请识别图片中的验证码文字，只返回纯文字内容，不要任何解释或其他内容。"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{captcha_b64}"}}
                ]
            }]
        }
        headers = aisettings._build_headers("openai", api_key)

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        # 去掉可能的引号/空格
        text = text.strip("\"' \n\r\t")
        return text if text else None
    except Exception as e:
        _log(f"campus auto captcha failed: {str(e)[:150]}")
        return None


def _try_auto_captcha(client, sess, captcha_b64, kind, user_id, db, **kw):
    """尝试 AI 自动识别验证码。成功返回完整查询结果 dict，失败返回 None（让前端弹手动框）"""
    vision = _resolve_vision_model(user_id, db)
    if not vision:
        return None
    captcha_text = _ai_solve_captcha(_b64(captcha_b64), vision)
    if not captcha_text:
        return None
    try:
        from campus.dekt import DektError
        if kind == "grades":
            client.complete_jwxt_login(sess.student_id, captcha_text)
            data = client.fetch_grades(sess.student_id, xnm=kw.get("xnm", ""), xqm=kw.get("xqm", ""))
        elif kind == "ecard":
            client.complete_login(sess.student_id, captcha_text)
            data = client.fetch_ecard_qr(codetype=kw.get("codetype", "O5"))
        else:
            client.complete_login(sess.student_id, captcha_text)
            data = {"score": client.fetch_score(sess.student_id)}
        return {"ok": True, "data": data, "student_id": client.student_id, "auto_captcha_used": True}
    except Exception as e:
        # AI 识别的验证码错误 → 让前端弹出手动验证码框
        _log(f"campus auto captcha login failed: {str(e)[:150]}")
        return None


class QueryRequest(BaseModel):
    xnm: str = ""
    xqm: str = ""
    codetype: str = "O5"


# ── 电费查询（必须在 query/{kind} 之前注册，否则被通配路由拦截） ──

@router.post("/api/campus/query/electricity", tags=["校园服务"])
def campus_query_electricity(request: Request,
                             current_user: User = Depends(get_current_user_obj),
                             db: OrmSession = Depends(get_db)):
    """查询电费（校付宝 epeortal 公网 API，无需 VPN；需已填寝室+支付密码）"""
    cred = _load_cred(current_user, db)
    dorm = (cred.dorm or "").strip()
    if not dorm:
        raise HTTPException(status_code=400, detail="请先在「我的 → 校园服务」填写默认寝室")
    real_name = (cred.real_name or "").strip()
    pay_pwd = _decrypt_or_400(cred.pay_password_enc) if cred.pay_password_enc else ""

    ec = _get_electricity_client()
    try:
        result = ec.query(cred.student_id, real_name, pay_pwd, dorm)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"电费查询失败：{e}")

    # 写入历史记录
    rec = ElectricityRecord(
        user_id=current_user.id,
        dorm=dorm,
        balance=result.get("balance"),
        remain=result.get("remain"),
        raw_json=json.dumps(result.get("raw"), ensure_ascii=False)[:2000] if result.get("raw") else None,
    )
    db.add(rec)
    db.commit()

    return {
        "ok": True,
        "data": {
            "balance": result.get("balance"),
            "card_balance": result.get("card_balance"),
            "remain": result.get("remain"),
            "dorm": result.get("dorm_info", dorm),
        },
    }


@router.post("/api/campus/query/{kind}", tags=["校园服务"])
def campus_query(kind: str, req: QueryRequest, request: Request,
                 current_user: User = Depends(get_current_user_obj),
                 db: OrmSession = Depends(get_db)):
    sess, client, cred = _connected_client(current_user, db)
    # 各用户用自己的凭据登录学工/教务（共享的只是 VPN 隧道）
    password = _decrypt_or_400(cred.vpn_password_enc)
    student_id = cred.student_id
    auto = bool(cred.auto_captcha)

    # score / grades / ecard 共用逻辑：若需要验证码且开启 auto_captcha → AI 自动填码
    if kind == "score":
        if client.session is None:
            pending = _safe_prepare(client, lambda: client.prepare_login(student_id, password))
            if pending is not None:
                if auto:
                    r = _try_auto_captcha(client, sess, pending.captcha, "score",
                                          current_user.id, db, xnm=req.xnm, xqm=req.xqm, codetype=req.codetype)
                    if r is not None:
                        return r
                return {"need_captcha": True, "kind": "score",
                        "captcha_base64": _b64(pending.captcha)}
        try:
            return {"ok": True, "data": {"score": client.fetch_score(student_id)},
                    "student_id": client.student_id}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    if kind == "grades":
        if client.jwxt_session is None:
            pending = _safe_prepare(client, lambda: client.prepare_jwxt_login(student_id, password))
            if pending is not None:
                if auto:
                    r = _try_auto_captcha(client, sess, pending.captcha, "grades",
                                          current_user.id, db, xnm=req.xnm, xqm=req.xqm, codetype=req.codetype)
                    if r is not None:
                        return r
                return {"need_captcha": True, "kind": "grades",
                        "captcha_base64": _b64(pending.captcha)}
        try:
            return {"ok": True,
                    "data": client.fetch_grades(student_id, xnm=req.xnm, xqm=req.xqm),
                    "student_id": client.student_id}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    if kind == "ecard":
        if client.session is None:
            pending = _safe_prepare(client, lambda: client.prepare_login(student_id, password))
            if pending is not None:
                if auto:
                    r = _try_auto_captcha(client, sess, pending.captcha, "ecard",
                                          current_user.id, db, xnm=req.xnm, xqm=req.xqm, codetype=req.codetype)
                    if r is not None:
                        return r
                return {"need_captcha": True, "kind": "ecard",
                        "captcha_base64": _b64(pending.captcha)}
        try:
            return {"ok": True, "data": client.fetch_ecard_qr(codetype=req.codetype or "O5"),
                    "student_id": client.student_id}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    raise HTTPException(status_code=404, detail="未知查询类型")


class LoginRequest(BaseModel):
    kind: str = "score"       # score | grades | ecard
    captcha: str = ""
    xnm: str = ""
    xqm: str = ""
    codetype: str = "O5"


@router.post("/api/campus/login", tags=["校园服务"])
def campus_login(req: LoginRequest, current_user: User = Depends(get_current_user_obj),
                 db: OrmSession = Depends(get_db)):
    if not (req.captcha or "").strip():
        raise HTTPException(status_code=400, detail="请填写验证码")
    sess, client, cred = _connected_client(current_user, db)
    student_id = cred.student_id
    try:
        if req.kind == "grades":
            client.complete_jwxt_login(student_id, req.captcha.strip())
            data = client.fetch_grades(student_id, xnm=req.xnm, xqm=req.xqm)
        elif req.kind == "ecard":
            client.complete_login(student_id, req.captcha.strip())
            data = client.fetch_ecard_qr(codetype=req.codetype or "O5")
        else:
            client.complete_login(student_id, req.captcha.strip())
            data = {"score": client.fetch_score(student_id)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "data": data, "student_id": client.student_id}


def _safe_prepare(client, fn):
    from campus.dekt import DektError
    try:
        return fn()
    except DektError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _b64(data: bytes) -> str:
    return base64.b64encode(data or b"").decode()


# ============================================================
# 电费查询
# ============================================================

def _get_electricity_client(sess=None):
    """电费客户端：epeortal API 公网可达，直连即可（无需 VPN）。"""
    from campus.electricity import ElectricityClient
    return ElectricityClient()


@router.get("/api/campus/electricity/history", tags=["校园服务"])
def campus_electricity_history(
    days: int = 30,
    current_user: User = Depends(get_current_user_obj),
    db: OrmSession = Depends(get_db),
):
    """获取电费历史记录（最近 N 天），用于折线图"""
    from datetime import datetime, timedelta
    since = datetime.utcnow() - timedelta(days=min(max(days, 1), 365))
    records = (
        db.query(ElectricityRecord)
        .filter(ElectricityRecord.user_id == current_user.id)
        .filter(ElectricityRecord.queried_at >= since)
        .order_by(ElectricityRecord.queried_at.asc())
        .all()
    )
    return {
        "ok": True,
        "records": [
            {
                "balance": r.balance,
                "remain": r.remain,
                "dorm": r.dorm,
                "time": r.queried_at.isoformat() if r.queried_at else None,
            }
            for r in records
        ],
    }


class RechargeRequest(BaseModel):
    amount: float


@router.post("/api/campus/recharge", tags=["校园服务"])
def campus_recharge(req: RechargeRequest, request: Request,
                    current_user: User = Depends(get_current_user_obj),
                    db: OrmSession = Depends(get_db)):
    """充值电费（校付宝 epeortal 公网 API，无需 VPN；需已填寝室+支付密码）"""
    if req.amount <= 0 or req.amount > 500:
        raise HTTPException(status_code=400, detail="充值金额须在 0-500 元之间")

    cred = _load_cred(current_user, db)
    dorm = (cred.dorm or "").strip()
    if not dorm:
        raise HTTPException(status_code=400, detail="请先在「我的 → 校园服务」填写默认寝室")
    real_name = (cred.real_name or "").strip()
    pay_pwd = _decrypt_or_400(cred.pay_password_enc) if cred.pay_password_enc else ""

    ec = _get_electricity_client()
    try:
        result = ec.recharge(cred.student_id, real_name, pay_pwd, dorm, req.amount)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"充值失败：{e}")

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message", "充值失败"))

    # 充值后自动查询一次最新余额并记录
    new_balance = None
    try:
        q = ec.query(cred.student_id, real_name, pay_pwd, dorm)
        new_balance = q.get("balance")
        rec = ElectricityRecord(
            user_id=current_user.id,
            dorm=dorm,
            balance=q.get("balance"),
            remain=q.get("remain"),
            raw_json=json.dumps({"recharge": result.get("raw"), "query_after": q.get("raw")}, ensure_ascii=False)[:2000],
        )
        db.add(rec)
        db.commit()
    except Exception:
        pass  # 充值成功但查询失败不阻塞

    return {
        "ok": True,
        "message": result.get("message", "充值成功"),
        "data": {
            "balance": new_balance,
            "card_balance": result.get("balance"),  # 支付后校园卡余额
            "amount": result.get("amount"),
        },
    }


# ============================================================
# 电费自动采集（供 scheduler 调用）
# ============================================================

def auto_query_electricity():
    """为所有已配置寝室且 VPN 在线的用户自动查询电费并记录。"""
    from datetime import datetime
    m = _get_managers()
    if "error" in m:
        return
    from database import SessionLocal
    db = SessionLocal()
    try:
        creds = db.query(CampusCred).filter(
            CampusCred.dorm != "",
            CampusCred.dorm.isnot(None),
        ).all()
        for cred in creds:
            try:
                ec = _get_electricity_client()
                real_name = (cred.real_name or "").strip()
                pay_pwd = ""
                if cred.pay_password_enc:
                    try:
                        pay_pwd = aisettings.decrypt_secret(cred.pay_password_enc) or ""
                    except Exception:
                        pass
                result = ec.query(cred.student_id, real_name, pay_pwd, cred.dorm)
                rec = ElectricityRecord(
                    user_id=cred.user_id,
                    dorm=cred.dorm,
                    balance=result.get("balance"),
                    remain=result.get("remain"),
                    raw_json=json.dumps(result.get("raw"), ensure_ascii=False)[:2000] if result.get("raw") else None,
                )
                db.add(rec)
                db.commit()
                _log(f"auto electricity query: user={cred.user_id} dorm={cred.dorm} balance={result.get('balance')}")
            except Exception as e:
                _log(f"auto electricity query failed: user={cred.user_id} err={str(e)[:150]}")
    finally:
        db.close()
