# features/campus_activities.py — 第二课堂活动查询（学工「活动报名」引导页看板）
# 适配自 Second_Class_Notification：列表 getHdgcHdList.zf + 详情 details.zf(hdms 活动说明)。
# 会话选路：自己已连接的会话 → 共享会话池（免配置，只读公开数据）→ 有凭据则自动连自己的。
# 个人数据（分数/成绩/校园卡）永远不走共享池，见 features/campus_pool.py。
# 路由不用 /api/campus/query/activities：campus_service 的通配路由 POST /api/campus/query/{kind}
# 按字母序先注册会把它拦走。

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as OrmSession

from campus import activities as act
from database import get_db
from deps import get_current_user_obj
from models import User

router = APIRouter()


def _pool_client(m):
    """从共享池轮转取一个就绪客户端；池不可用返回 None。"""
    pool = m.get("pool")
    if pool is None:
        return None
    got = pool.acquire()
    return got[1] if got else None


def _pool_stale(m, client):
    pool = m.get("pool")
    if pool:
        for key in list(pool.ready):
            if pool.dekt.clients.get(key) is client:
                pool.mark_stale(key)
                return


def _query_captcha_flow(m, sess, client, current_user, db):
    """自己会话未登录学工时：auto_captcha 开启走 AI 识码，否则发验证码给前端。"""
    import features.campus_service as cs

    cred = cs._load_cred(current_user, db)
    if client.session is None:
        prepare = lambda: client.prepare_login(sess.student_id, sess.password)
        if cred.auto_captcha:
            r, pending = cs._auto_captcha_flow(client, sess, current_user.id, db,
                                               "activities", prepare, cs.QueryRequest())
            if r is not None:
                return r
        else:
            pending = cs._safe_prepare(client, prepare)
        if pending is not None:
            return {"need_captcha": True, "kind": "activities",
                    "captcha_base64": cs._b64(pending.captcha)}
    return None


def _pool_yield_guard(m, current_user, db):
    """池已让位（有其他用户会话在线）且本用户没有自己的凭据时，给明确提示而非误导性的「未填凭据」。"""
    import features.campus_service as cs

    pool = m.get("pool")
    if pool is None or not pool.yielded:
        return
    try:
        cs._load_cred(current_user, db)
    except HTTPException:
        raise HTTPException(
            status_code=400,
            detail="共享会话已暂时让位给其他用户的 VPN 连接，请稍后再试，或在「我的 → 校园服务」填写自己的凭据")


@router.post("/api/campus/activities", tags=["校园服务"])
def campus_activities(current_user: User = Depends(get_current_user_obj),
                      db: OrmSession = Depends(get_db)):
    """第二课堂活动列表；VPN 未连接返回 vpn_connecting，首次学工登录走验证码流程"""
    import features.campus_service as cs
    from campus.dekt import DektError

    m = cs._mgrs()

    # 1) 自己已连接的会话优先
    sess = m["sessions"].get(current_user.id)
    if sess and sess.status == "connected":
        client = m["dekt"].get(current_user.id, sess)
        r = _query_captcha_flow(m, sess, client, current_user, db)
        if r is not None:
            return r
        try:
            return {"ok": True, "data": act.activities_payload(client)}
        except DektError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # 2) 共享会话池（免配置；只服务公开数据）
    client = _pool_client(m)
    if client is not None:
        try:
            return {"ok": True, "data": act.activities_payload(client), "via_pool": True}
        except DektError:
            _pool_stale(m, client)   # 登录态失效 → 维护线程重登，本次落入回退

    # 3) 回退：用已存凭据自动连接自己的会话（无凭据时给明确提示）
    _pool_yield_guard(m, current_user, db)
    try:
        sess, client, cred = cs._connected_client(current_user, db)
    except cs._VpnConnecting:
        return {"vpn_connecting": True}
    r = _query_captcha_flow(m, sess, client, current_user, db)
    if r is not None:
        return r
    try:
        return {"ok": True, "data": act.activities_payload(client)}
    except DektError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/campus/activities/{aid}/detail", tags=["校园服务"])
def campus_activity_detail(aid: str, current_user: User = Depends(get_current_user_obj),
                           db: OrmSession = Depends(get_db)):
    """单个活动详情（hdms 活动说明全文 + 名额/报名线索解析）"""
    import features.campus_service as cs
    from campus.dekt import DektError

    m = cs._mgrs()

    sess = m["sessions"].get(current_user.id)
    if sess and sess.status == "connected":
        client = m["dekt"].get(current_user.id, sess)
        if client.session is None:
            raise HTTPException(status_code=400, detail="学工登录已失效，请重新查询活动列表")
        try:
            data = client.fetch_activity_detail(aid)
        except DektError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return _detail_payload(aid, data)

    client = _pool_client(m)
    if client is not None:
        try:
            data = client.fetch_activity_detail(aid)
            return _detail_payload(aid, data)
        except DektError:
            _pool_stale(m, client)

    _pool_yield_guard(m, current_user, db)
    try:
        sess, client, cred = cs._connected_client(current_user, db)
    except cs._VpnConnecting:
        return {"vpn_connecting": True}
    if client.session is None:
        raise HTTPException(status_code=400, detail="学工登录已失效，请重新查询活动列表")
    try:
        data = client.fetch_activity_detail(aid)
    except DektError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _detail_payload(aid, data)


def _detail_payload(aid, data):
    hdms = str(data.get("hdms") or "")
    return {"ok": True, "data": {"id": aid, "hdms": hdms,
                                 "quota": act.extract_quota(hdms),
                                 "signup": act.extract_signup(hdms)}}
