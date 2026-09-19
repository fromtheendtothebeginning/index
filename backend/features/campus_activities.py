# features/campus_activities.py — 第二课堂活动查询（学工「活动报名」引导页看板）
# 适配自 Second_Class_Notification：列表 getHdgcHdList.zf + 详情 details.zf(hdms 活动说明)。
# 复用 campus_service 的 VPN 会话 / CAS 登录 / AI 验证码流程（跨模块先例同 electricity.py）。
# 路由不用 /api/campus/query/activities：campus_service 的通配路由 POST /api/campus/query/{kind}
# 按字母序先注册会把它拦走。

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as OrmSession

from campus import activities as act
from database import get_db
from deps import get_current_user_obj
from models import User

router = APIRouter()


@router.post("/api/campus/activities", tags=["校园服务"])
def campus_activities(current_user: User = Depends(get_current_user_obj),
                      db: OrmSession = Depends(get_db)):
    """第二课堂活动列表；VPN 未连接返回 vpn_connecting，首次学工登录走验证码流程"""
    import features.campus_service as cs

    try:
        sess, client, cred = cs._connected_client(current_user, db)
    except cs._VpnConnecting:
        return {"vpn_connecting": True}
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
    try:
        from campus.dekt import DektError
        return {"ok": True, "data": act.activities_payload(client)}
    except DektError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/campus/activities/{aid}/detail", tags=["校园服务"])
def campus_activity_detail(aid: str, current_user: User = Depends(get_current_user_obj),
                           db: OrmSession = Depends(get_db)):
    """单个活动详情（hdms 活动说明全文 + 名额/报名线索解析）"""
    import features.campus_service as cs

    try:
        sess, client, cred = cs._connected_client(current_user, db)
    except cs._VpnConnecting:
        return {"vpn_connecting": True}
    if client.session is None:
        raise HTTPException(status_code=400, detail="学工登录已失效，请重新查询活动列表")
    try:
        from campus.dekt import DektError
        data = client.fetch_activity_detail(aid)
    except DektError as e:
        raise HTTPException(status_code=400, detail=str(e))
    hdms = str(data.get("hdms") or "")
    return {"ok": True, "data": {"id": aid, "hdms": hdms,
                                 "quota": act.extract_quota(hdms),
                                 "signup": act.extract_signup(hdms)}}
