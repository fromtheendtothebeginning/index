# features/campus_service.py — 校园服务工具（EasyConnect VPN + 第二课堂分/成绩/校园卡动态码）
# 移植自 SCHOOLALY（独立 FastAPI 服务）并融合 anticraft：
#   - 凭据存 campus_creds 表（密码用 aisettings 加密），每用户自己填写
#   - VPN 会话按 user_id 维度单例（backend/campus/sessions.SessionManager）
#   - 查询客户端 backend/campus/dekt.DektClient，走该用户容器 socks 隧道
# 电费相关（openservice/SM4）本次不移植。

import base64
import json
import threading
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session as OrmSession

import aisettings
from database import get_db
from deps import _log, get_current_user_obj
from models import AiKey, AiSetting, CampusCred, User

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
            from campus.config import Config
            from campus.dekt import DektManager
            from campus.docker_mgr import DockerManager
            from campus.sessions import SessionManager

            cfg = Config()
            try:
                docker = DockerManager(cfg)
                docker.cleanup_orphans()
                sessions = SessionManager(cfg, docker)
                dekt = DektManager(cfg)
                _singletons = {"cfg": cfg, "docker": docker, "sessions": sessions, "dekt": dekt}
            except Exception as e:
                _log(f"campus docker init failed: {str(e)[:200]}")
                _singletons = {"error": str(e)[:300]}
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
    c.dorm = (req.dorm or "").strip()[:100]
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
# VPN 会话
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
        "host": getattr(sess, "proxy_host", "127.0.0.1"),
    }


@router.post("/api/campus/connect", tags=["校园服务"])
def campus_connect(request: Request, current_user: User = Depends(get_current_user_obj), db: OrmSession = Depends(get_db)):
    m = _mgrs()
    c = _load_cred(current_user, db)
    vpn_pwd = _decrypt_or_400(c.vpn_password_enc)
    try:
        m["sessions"].create(current_user.id, c.student_id, vpn_pwd)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _session_payload(m["sessions"].get(current_user.id), request)


@router.get("/api/campus/status", tags=["校园服务"])
def campus_status(request: Request, current_user: User = Depends(get_current_user_obj)):
    m = _mgrs()
    return _session_payload(m["sessions"].get(current_user.id), request)


@router.post("/api/campus/disconnect", tags=["校园服务"])
def campus_disconnect(current_user: User = Depends(get_current_user_obj)):
    m = _mgrs()
    m["sessions"].disconnect(current_user.id)
    m["dekt"].drop(current_user.id)
    return {"ok": True}


# ============================================================
# 校园查询（score / grades / ecard）
# ============================================================

def _connected_client(current_user, db):
    """返回 (session, dekt_client)；未连接/凭据缺失时抛 4xx"""
    m = _mgrs()
    sess = m["sessions"].get(current_user.id)
    if not sess or sess.status != "connected":
        raise HTTPException(status_code=400, detail="VPN 未连接，请先连接校园网")
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
    return {"provider": provider, "api_key": api_key, "model": s.vision_model, "base_url": base_url,
            "thinking": s.vision_thinking or ""}


def _ai_solve_captcha(captcha_b64, vision_info, timeout=30):
    """调用识图模型识别验证码图片，返回文字或 None"""
    provider = vision_info["provider"]
    api_key = vision_info["api_key"]
    model = vision_info["model"]
    base_url = vision_info["base_url"]

    if not base_url:
        # 从后端 provider 表取默认 base_url
        # （此前误引前端的 utils/aiProviders，后端没这个模块 → ModuleNotFoundError → 查询 500）
        p = aisettings.get_provider(provider)
        base_url = (p.get("base_url") or "") if p else ""
    base_url = base_url.rstrip("/")
    if not base_url:
        _log(f"campus auto captcha skipped: provider={provider} 无默认 base_url")
        return None

    # 构造 vision chat 请求（openai 兼容格式）
    url = f"{base_url}/chat/completions"
    if provider == "anthropic":
        # anthropic 格式：messages content 带 image 类型
        payload = {
            "model": model,
            "max_tokens": 512,  # 推理型视觉模型会先花 token 思考，100 会被 reasoning 吃光导致 content 为空
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": captcha_b64}},
                    {"type": "text", "text": "请只输出图片中的验证码字符本身（区分大小写；不要空格、标点、引号，也不要任何解释或说明）。"}
                ]
            }]
        }
        headers = aisettings._build_headers("anthropic", api_key)
    else:
        # openai 兼容格式
        payload = {
            "model": model,
            "max_tokens": 512,  # 推理型视觉模型会先花 token 思考，100 会被 reasoning 吃光导致 content 为空
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "请只输出图片中的验证码字符本身（区分大小写；不要空格、标点、引号，也不要任何解释或说明）。"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{captcha_b64}"}}
                ]
            }]
        }
        headers = aisettings._build_headers("openai", api_key)

    # 思考深度：按 provider 写入思考参数（未配置则不加，跟随模型默认）
    base_keys = set(payload)
    payload = aisettings.apply_thinking(payload, provider, vision_info.get("thinking"))
    thinking_keys = [k for k in payload if k not in base_keys]

    def _post(body):
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    try:
        try:
            data = _post(payload)
        except urllib.error.HTTPError as e:
            # 400 且本次确实加了思考参数：去掉该参数重试一次（部分模型/兼容层不认）
            if e.code != 400 or not thinking_keys:
                raise
            _log("campus auto captcha: thinking param rejected, retry without it")
            data = _post({k: v for k, v in payload.items() if k not in thinking_keys})
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        # 去掉可能的引号/空格
        text = text.strip("\"' \n\r\t")
        _log(f"campus auto captcha recognized: {text!r}")
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


def _auto_captcha_flow(client, sess, user_id, db, kind, prepare, req, attempts=2):
    """开启 auto_captcha 时的识码流程：最多 attempts 轮「取新验证码 → AI 识别 → 提交登录」。

    全部失败时**再取一张全新验证码**交回前端手动输入。此前是把失败的验证码直接退回，
    而那张已被登录尝试消耗掉，用户手填必然报「验证码错误」，看起来像"勾了 AI 识别就再也过不去"。
    返回 (成功结果 | None, 待验证码对象 | None)。
    """
    pending = None
    for _ in range(max(1, attempts)):
        pending = _safe_prepare(client, prepare)
        if pending is None:
            return None, None
        r = _try_auto_captcha(client, sess, pending.captcha, kind, user_id, db,
                              xnm=req.xnm, xqm=req.xqm, codetype=req.codetype)
        if r is not None:
            return r, None
    return None, (_safe_prepare(client, prepare) or pending)


@router.post("/api/campus/query/{kind}", tags=["校园服务"])
def campus_query(kind: str, req: QueryRequest, request: Request,
                 current_user: User = Depends(get_current_user_obj),
                 db: OrmSession = Depends(get_db)):
    sess, client, cred = _connected_client(current_user, db)
    password = sess.password
    auto = bool(cred.auto_captcha)

    # score / grades / ecard 共用逻辑：若需要验证码且开启 auto_captcha → AI 自动填码
    if kind == "score":
        if client.session is None:
            prepare = lambda: client.prepare_login(sess.student_id, password)
            if auto:
                r, pending = _auto_captcha_flow(client, sess, current_user.id, db, "score", prepare, req)
                if r is not None:
                    return r
            else:
                pending = _safe_prepare(client, prepare)
            if pending is not None:
                return {"need_captcha": True, "kind": "score",
                        "captcha_base64": _b64(pending.captcha)}
        try:
            return {"ok": True, "data": {"score": client.fetch_score(sess.student_id)},
                    "student_id": client.student_id}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    if kind == "grades":
        if client.jwxt_session is None:
            prepare = lambda: client.prepare_jwxt_login(sess.student_id, password)
            if auto:
                r, pending = _auto_captcha_flow(client, sess, current_user.id, db, "grades", prepare, req)
                if r is not None:
                    return r
            else:
                pending = _safe_prepare(client, prepare)
            if pending is not None:
                return {"need_captcha": True, "kind": "grades",
                        "captcha_base64": _b64(pending.captcha)}
        try:
            return {"ok": True,
                    "data": client.fetch_grades(sess.student_id, xnm=req.xnm, xqm=req.xqm),
                    "student_id": client.student_id}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    if kind == "ecard":
        if client.session is None:
            prepare = lambda: client.prepare_login(sess.student_id, password)
            if auto:
                r, pending = _auto_captcha_flow(client, sess, current_user.id, db, "ecard", prepare, req)
                if r is not None:
                    return r
            else:
                pending = _safe_prepare(client, prepare)
            if pending is not None:
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
    try:
        if req.kind == "grades":
            client.complete_jwxt_login(sess.student_id, req.captcha.strip())
            data = client.fetch_grades(sess.student_id, xnm=req.xnm, xqm=req.xqm)
        elif req.kind == "ecard":
            client.complete_login(sess.student_id, req.captcha.strip())
            data = client.fetch_ecard_qr(codetype=req.codetype or "O5")
        else:
            client.complete_login(sess.student_id, req.captcha.strip())
            data = {"score": client.fetch_score(sess.student_id)}
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
