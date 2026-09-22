# features/sit_portal.py — SIT 信息门户（portal.sit.edu.cn）反向代理：流量经服务器校园网隧道
#
# 为什么需要：portal.sit.edu.cn 只在校园网内可达（公网直连超时），手机直连必然失败。
# 这里把门户反代到 /api/sit/ 下（nginx 已把 /api/ 转给后端，不用改 nginx），
# 上游请求走【该用户自己的】VPN 会话 SOCKS —— 门户是个人数据，按项目约定不走共享池。
#
# 登录：CAS 认证服务器 authserver.sit.edu.cn 是公网可达的，所以不代理它——
# 把门户给出的 service 参数改写成我们的代理地址，用户在真实 CAS 页面登录（验证码也在那边），
# 登录后带 ticket 跳回 /api/sit/...，由我们转发给门户完成 SSO（Cookie 存服务端会话）。
#
# 鉴权：WebView 的整页导航带不了 Authorization 头，所以首访用 ?t=<JWT> 换一个
# HttpOnly Cookie（Path=/api/sit）作为后续导航凭据。
#
# ⚠ 必须挂在 /api/sit/：nginx 只把 /api/ 转发给后端，其他前缀会落到前端 SPA。
# ⚠ 路径前缀反代要改写门户 JS 里用 window.location.host 拼的绝对地址（见 _HOST_VAR_RE）；
#   门户若新增同类写法，需同步补规则。

import html as html_mod
import os
import re
import threading
import time
from urllib.parse import urlencode, urljoin

import requests
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.orm import Session as OrmSession

from database import get_db
from deps import get_optional_user

router = APIRouter()

PREFIX = "/api/sit"                                 # 对外暴露的代理前缀
UPSTREAM = "https://portal.sit.edu.cn"              # 门户真实地址
UPSTREAM_HOSTS = ("portal.sit.edu.cn", "my.sit.edu.cn")   # my.sit.edu.cn 会 302 到 portal
COOKIE_NAME = "sit_sess"                            # 代理自身的鉴权 Cookie
SESSION_TTL = 8 * 3600                              # 上游会话（含门户登录态）最长保留
TIMEOUT = 60
PROBE_TIMEOUT = 8          # 隧道探活用的短超时（避免隧道没起来时干等）
MAX_BYTES = 30 * 1024 * 1024                        # 单个响应体上限
UA = ("Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")

# 逐跳头 + 必须由我们自己控制的头
_DROP_REQ_HEADERS = {
    "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length",
    "accept-encoding", "cookie",
}
_DROP_RESP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "content-length", "content-encoding",
}

_clients = {}   # user_id -> {"sess": requests.Session, "port": int, "created": float}
_lock = threading.Lock()


# ============================================================
# 上游会话：每用户一个 Cookie 罐（就是门户登录态），SOCKS 端口变了就重建
# ============================================================

def _socks_endpoint(user_id: int):
    """上游 SOCKS 地址 (host, port)：默认取该用户自己已连接的 VPN 会话；未连接返回 None。

    本地联调（没有 docker/隧道）可用环境变量 SIT_PORTAL_SOCKS=host:port 临时指定一个，仅测试用。
    """
    dev = os.environ.get("SIT_PORTAL_SOCKS", "").strip()
    if dev and ":" in dev:
        host, _, port = dev.rpartition(":")
        try:
            return host, int(port)
        except ValueError:
            return None
    from features.campus_service import _get_managers
    try:
        m = _get_managers()
        if "error" in m:
            return None
        sess = m["sessions"].get(user_id)
        if not sess or sess.status != "connected":
            return None
        return "127.0.0.1", sess.socks_port     # 容器端口发布在后端主机上，走本机回环
    except Exception:
        return None


def _upstream_session(user_id: int, host: str, port: int) -> requests.Session:
    with _lock:
        c = _clients.get(user_id)
        if c and (c["host"], c["port"]) == (host, port) and time.time() - c["created"] < SESSION_TTL:
            return c["sess"]
        s = requests.Session()
        s.verify = False
        s.trust_env = False
        s.headers["User-Agent"] = UA
        s.proxies = {"http": f"socks5h://{host}:{port}", "https": f"socks5h://{host}:{port}"}
        _clients[user_id] = {"sess": s, "host": host, "port": port, "created": time.time()}
        return s


# ============================================================
# 改写
# ============================================================

_ATTR_RE = re.compile(
    r"""(\b(?:src|href|action|poster|data-src|data-url|data-href|formaction)\s*=\s*)"""
    r"""(["'])(.*?)\2""", re.I | re.S)
_CSS_URL_RE = re.compile(r"""url\(\s*(['"]?)([^'")]+)\1\s*\)""", re.I)
_HOST_VAR_RE = re.compile(
    r"""window\.location\.protocol\s*\+\s*["']//["']\s*\+\s*window\.location\.host""")
# 由 host 拼出的站内跳转（host+"/r/login.html" 等）必须走代理，否则会跳到校园内网真站
_HOST_NAV_RE = re.compile(r"""host\s*\+\s*(["'])/r/""")
# 引导页的三元判断：ck_ ? 已登录入口 : OAuth(会跳 CAS)。服务端已登录，强制走已登录分支
_SSO_BRANCH_RE = re.compile(
    r"""u\s*=\s*ck_\s*\?\s*['"]\./r/w\?['"]\s*\+\s*u\s*:\s*['"]\./r/or\?['"]\s*\+\s*u\s*"""
    r"""\+\s*['"]&oauthName=ssologins&f=['"]\s*\+\s*m\.OAUTH_DEF\s*;""")
_SKIP_SCHEMES = ("data:", "javascript:", "mailto:", "tel:", "blob:", "about:", "#")


def _map_abs(abs_url: str, origin: str) -> str:
    """上游绝对地址 → 代理地址；站外地址原样返回"""
    for host in UPSTREAM_HOSTS:
        for scheme in ("https://", "http://"):
            if abs_url.lower().startswith(scheme + host):
                return origin + PREFIX + abs_url[len(scheme) + len(host):]
    return abs_url


def _map_ref(ref: str, base_url: str, origin: str) -> str:
    """一个引用（可能相对、可能绝对）→ 代理地址"""
    r = (ref or "").strip()
    if not r or r.lower().startswith(_SKIP_SCHEMES):
        return ref
    if r.startswith("//"):                      # 协议相对
        return _map_abs("https:" + r, origin)
    if r.startswith(("http://", "https://")):
        return _map_abs(r, origin)
    if r.startswith("/"):                       # 站内根相对
        return origin + PREFIX + r
    return _map_abs(urljoin(base_url, r), origin)   # 相对 → 按原始 URL 解析后映射


def _rewrite_html(text: str, base_url: str, origin: str) -> str:
    def attr(m):
        return m.group(1) + m.group(2) + _map_ref(m.group(3), base_url, origin) + m.group(2)
    text = _ATTR_RE.sub(attr, text)
    text = _CSS_URL_RE.sub(
        lambda m: "url(" + m.group(1) + _map_ref(m.group(2), base_url, origin) + m.group(1) + ")",
        text)
    return _rewrite_scripts(text, origin)


def _rewrite_css(text: str, base_url: str, origin: str) -> str:
    return _CSS_URL_RE.sub(
        lambda m: "url(" + m.group(1) + _map_ref(m.group(2), base_url, origin) + m.group(1) + ")",
        text)


def _rewrite_scripts(text: str, origin: str) -> str:
    """脚本/JSON 里的站点地址：改成我们域的绝对地址（new URL() 之类也能用）"""
    # JS 里 "../commons/..." 这类相对引用（门户 public.js 用 document.write 写 <script>）
    # 在真站解析到「站点根/commons」，在路径前缀下会多退一级变成 /api/commons → 直接改成前缀绝对地址
    text = re.sub(r"""(["'(])\.\./+commons/""",
                  lambda m: m.group(1) + origin + PREFIX + "/commons/", text)
    bare = origin.split("//", 1)[-1]
    for host in UPSTREAM_HOSTS:
        text = text.replace("https://" + host, origin + PREFIX)
        text = text.replace("http://" + host, origin + PREFIX)
        text = text.replace("//" + host, origin + PREFIX)
        # 兜底：门户的跳转里 redirect_uri/service 常是百分号编码的，host 部分是明文
        text = text.replace(host, bare + PREFIX)
    # 引导页的 host 变量：既要给门户当 yu 返回值参数（门户会校验，必须是它认识的地址），
    # 又要拼站内跳转 → 前者保持门户真实源，后者单独改写成"我们的域+前缀"。
    text = _HOST_VAR_RE.sub('"' + UPSTREAM + '"', text)
    text = _HOST_NAV_RE.sub('"' + origin + PREFIX + '/r/', text)
    # 服务端已经登录了：把「没 ck_ 就跳 OAuth/CAS」的分支改成直接走已登录入口，
    # 否则引导页会自己跳一次 CAS（那边会落到坏 worker 报 500）
    return _SSO_BRANCH_RE.sub("u = './r/w?'+u;", text)


def _rewrite_location(value: str, origin: str) -> str:
    """Location 改写；但指向 CAS 的一律原样透传 —— 学校 CAS 对 OAuth 回调地址做白名单校验
    （实测报「传递的 redirect_uri 跟注册的回调地址不匹配」），改写就会被拒；
    登录后浏览器会被送到真实的 portal.sit.edu.cn，由 App 在导航层映射回代理。"""
    if "authserver.sit.edu.cn" in value:
        # 学校 CAS 的 login;jsessionid=xxx!route 形式在浏览器里会 500（curl 同一地址却是 200），
        # 去掉 jsessionid 路径参数让 CAS 自己重新分配会话
        return re.sub(r";jsessionid=[^?&]*", "", value)
    return _rewrite_scripts(_map_ref(value, UPSTREAM + "/", origin), origin)


def _rewrite_cookie(value: str) -> str:
    """Set-Cookie：去掉 Domain，把 Path 挪到代理前缀下"""
    parts = [p.strip() for p in value.split(";")]
    out = [parts[0]]
    for p in parts[1:]:
        low = p.lower()
        if low.startswith("domain="):
            continue
        if low.startswith("path="):
            path = p[5:].strip()
            p = "Path=" + (PREFIX + path if path.startswith("/") else PREFIX + "/")
        out.append(p)
    return "; ".join(out)


def _decode_body(raw: bytes, declared: str) -> str:
    """门户实测不声明 charset（真身是带 BOM 的 UTF-8），不能盲信声明值，也不能用 requests 的默认拉丁解码。
    顺序：BOM/UTF-8（严格）→ 声明值 → GBK（中文站遗留编码）→ 最终容错。"""
    for enc in ("utf-8-sig", declared, "gbk"):
        if not enc:
            continue
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="replace")


def _rewrite_referer(value: str, origin: str) -> str:
    """把我们的代理地址还原成门户地址（门户的 CSRF/校验可能看 Referer/Origin）"""
    if value.startswith(origin + PREFIX):
        return UPSTREAM + value[len(origin) + len(PREFIX):]
    return value


# ============================================================
# 提示页
# ============================================================

def _page(title: str, body: str, origin: str, status_code: int = 200, refresh: int = 0) -> HTMLResponse:
    title = html_mod.escape(title)
    safe_origin = html_mod.escape(origin)
    html = f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{title}</title>{f'<meta http-equiv="refresh" content="{refresh}">' if refresh else ''}
<style>body{{margin:0;padding:48px 24px;font:17px/1.8 system-ui,-apple-system,"PingFang SC",sans-serif;
background:#f8f9fa;color:#222;text-align:center}}h1{{font-size:22px;margin:0 0 16px}}
p{{margin:0 0 12px;color:#555}}a.btn{{display:inline-block;margin-top:8px;padding:12px 26px;border-radius:24px;
background:#6c5ce7;color:#fff;text-decoration:none;font-weight:600}}a{{color:#6c5ce7}}</style></head>
<body><h1>{title}</h1>{body}
<p><a href="{safe_origin}/tools/campus-service">← 返回校园服务</a></p></body></html>"""
    return HTMLResponse(html, status_code=status_code)


# ============================================================
# 代理入口
# ============================================================

@router.api_route("/api/sit/{path:path}",
                  methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
                  tags=["校园服务"])
async def sit_portal(path: str, request: Request, db: OrmSession = Depends(get_db)):
    """把 SIT 信息门户反代出去；上游走该用户自己的校园网隧道"""
    origin = f"{request.url.scheme}://{request.headers.get('host', 'anticraft.top')}"

    # 1) 鉴权：?t=<JWT> 首访换 Cookie（WebView 整页导航带不了 Authorization 头）
    token = request.cookies.get(COOKIE_NAME) or request.query_params.get("t")
    user = get_optional_user(token, db) if token else None
    if user is None:
        return _page("需要先登录 anticraft", "<p>请从 anticraft App 内打开信息门户。</p>", origin, 401)

    query = dict(request.query_params)
    if "t" in query:                      # 换成 Cookie 后把令牌从地址里去掉
        query.pop("t", None)
        target = f"{PREFIX}/{path}"
        if query:
            target += "?" + urlencode(query)
        resp = RedirectResponse(target, status_code=302)
        resp.set_cookie(COOKIE_NAME, token, max_age=SESSION_TTL, httponly=True,
                        samesite="lax", path=PREFIX)
        return resp

    # 2) 必须有自己的校园网会话（个人数据不走共享池）
    endpoint = _socks_endpoint(user.id)
    if endpoint is None:
        return _page("校园网未连接",
                     "<p>信息门户只在校园网内可达。</p>"
                     f'<p><a class="btn" href="{origin}{PREFIX}/connect">连接校园网并继续</a></p>',
                     origin)

    # 3) 转发（不跟随跳转，自己改写 Location）
    upstream_url = UPSTREAM + "/" + path
    if query:
        upstream_url += "?" + urlencode(query)
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _DROP_REQ_HEADERS}
    headers["Host"] = "portal.sit.edu.cn"
    headers["Accept-Encoding"] = "identity"          # 便于改写文本体
    for h in ("Referer", "Origin"):
        if h in headers:
            headers[h] = _rewrite_referer(headers[h], origin)
    body = await request.body() if request.method not in ("GET", "HEAD") else None

    sess = _upstream_session(user.id, endpoint[0], endpoint[1])

    def fetch():
        return sess.request(request.method, upstream_url, headers=headers, data=body,
                            allow_redirects=False, stream=True, timeout=TIMEOUT)

    try:
        up = fetch()
    except requests.exceptions.RequestException as e:
        return _page("门户连接失败",
                     f"<p>经校园网访问信息门户失败：{type(e).__name__}。请确认校园网连接正常后重试。</p>",
                     origin)

    # 门户没登录/掉线时上游会跳统一认证 → 服务端自己登录一次再重试（浏览器完全不碰 CAS）
    if _is_cas_redirect(up) or (path in ("", "/") and not _logged_flag(user.id)):
        if not _tunnel_alive(sess):
            up.close()
            return _page("校园网隧道还没就绪",
                         "<p>校园服务显示已连接，但隧道尚未真正建立（学校侧建立隧道通常要 40~90 秒，"
                         "刚连上马上点就会这样）。</p><p>请等约 30 秒再点一次「信息门户」；"
                         "若一直如此，回校园服务断开后重连一次。</p>", origin)
        up.close()
        ok, why = portal_login(user, db, sess)
        if not ok:
            return _login_page(origin, why)
        _logged_flag(user.id, True)
        try:
            up = fetch()
        except requests.exceptions.RequestException as e:
            return _page("门户连接失败", f"<p>重试访问门户失败：{type(e).__name__}</p>", origin)

    # 4) 响应头
    out_headers = {k: v for k, v in up.headers.items() if k.lower() not in _DROP_RESP_HEADERS}
    if "Location" in up.headers:
        out_headers["Location"] = _rewrite_location(up.headers["Location"], origin)
    cookies = up.raw.headers.getlist("set-cookie") if hasattr(up.raw.headers, "getlist") else []
    content_type = up.headers.get("Content-Type", "")

    # 5) 文本体改写（HTML/CSS/JS/JSON），其余原样透传
    is_text = any(t in content_type for t in ("text", "json", "javascript"))
    if up.status_code != 304 and is_text:
        raw = up.raw.read(MAX_BYTES + 1, decode_content=True)
        up.close()
        if len(raw) > MAX_BYTES:
            return _page("响应过大", "<p>该请求的响应体超过 30MB，已停止转发。</p>", origin, 502)
        declared = (re.search(r"charset=([\w\-]+)", content_type, re.I) or [None, ""])[1]
        text = _decode_body(raw, declared)
        if "html" in content_type:
            text = _rewrite_html(text, upstream_url, origin)
            media = "text/html"
        elif "css" in content_type:
            text = _rewrite_css(text, upstream_url, origin)
            media = "text/css"
        elif "json" in content_type:
            text = _rewrite_scripts(text, origin)
            media = "application/json"
        else:
            text = _rewrite_scripts(text, origin)
            media = "text/javascript"
        # 必须显式声明 utf-8：上游多半不写 charset，浏览器会猜错导致中文乱码
        out_headers["Content-Type"] = media + "; charset=utf-8"
        resp = Response(content=text.encode("utf-8"),
                        status_code=up.status_code, headers=out_headers, media_type=None)
    else:
        resp = Response(content=up.raw.read(MAX_BYTES, decode_content=True),
                        status_code=up.status_code, headers=out_headers, media_type=None)

    for c in cookies:                       # 多个 Set-Cookie 要逐个写回（不能合并）
        resp.raw_headers.append((b"set-cookie", _rewrite_cookie(c).encode("latin-1")))
    if "html" in content_type:
        # 门户引导页会读 document.cookie 判断登录态；把服务端会话里的 Cookie 回灌，
        # 它就不会再自己跳一次 CAS（那边会落到坏 worker 报 500）
        _replay_cookies(sess, resp, origin)
    return resp

# ============================================================
# 服务端登录：绕开学校 CAS（它的 OAuth authorize 会落到坏 worker，浏览器里 500）
# 思路：后端用该用户的统一认证会话把门户 OAuth 流程跑完，登录态留在服务端会话里，
#      并把 Cookie 回灌给浏览器，使门户引导页的客户端 SSO 检查直接通过。
# ============================================================

def _cas_session(user, db, http) -> tuple:
    """把 CAS(authserver) 登录态装进上游会话：
    - 校园服务里已有 CAS 会话 → 直接拷 Cookie（零验证码，最省事）
    - 没有 → 返回 (False, "NEED_LOGIN")，让调用方走现场登录（验证码走 AI 识图/手填）
    """
    from features.campus_service import _get_managers
    try:
        m = _get_managers()
        if "error" in m:
            return False, "校园服务未就绪"
        campus = m["sessions"].get(user.id)
        if not campus or campus.status != "connected":
            return False, "校园网未连接"
        dekt = m["dekt"].get(user.id, campus)
    except Exception as e:
        return False, f"校园服务不可用：{e}"
    if dekt.session is None:
        return False, "NEED_LOGIN"
    return _copy_cas_cookies(dekt, http)


def _copy_cas_cookies(dekt, http) -> tuple:
    if dekt.session is None:
        return False, "统一认证会话建立失败"
    for c in dekt.session.cookies:
        if c.domain and c.domain.endswith("authserver.sit.edu.cn"):
            http.cookies.set(c.name, c.value, domain=c.domain, path=c.path)
    return True, ""


def _fresh_cas_login(user, db, captcha_text: str = "") -> tuple:
    """现场做一次统一认证登录：captcha_text 为空时先取验证码（有 AI 识图就自动解）。
    返回 (True, "") / (False, "NEED_CAPTCHA") / (False, 原因)"""
    from features.campus_service import _ai_solve_captcha, _b64, _get_managers, _resolve_vision_model
    try:
        m = _get_managers()
        campus = m["sessions"].get(user.id)
        if not campus or campus.status != "connected":
            return False, "校园网未连接"
        dekt = m["dekt"].get(user.id, campus)
        pending = dekt.prepare_login(campus.student_id, campus.password)
    except Exception as e:
        return False, f"统一认证登录失败：{e}"
    if pending is None:
        return True, ""
    text = (captcha_text or "").strip()
    if not text:
        vision = None
        try:
            vision = _resolve_vision_model(user.id, db)
        except Exception:
            vision = None
        text = _ai_solve_captcha(_b64(pending.captcha), vision) if vision else None
        if not text:
            return False, "NEED_CAPTCHA"
    try:
        dekt.complete_login(campus.student_id, text)
    except Exception as e:
        return False, f"统一认证登录失败：{e}"
    return True, ""


def _portal_oauth(http) -> tuple:
    """带着 CAS 会话把门户 OAuth 跑完（服务端跟随跳转），成功即门户会话落在 http 的 Cookie 罐里"""
    try:
        r = http.post(UPSTREAM + "/r/jd?cmd=com.awspaas.user.apps.onlineoffice_getDefSSO",
                      data={"yu": UPSTREAM}, timeout=TIMEOUT,
                      headers={"Content-Type": "application/x-www-form-urlencoded"})
        m = ((r.json() or {}).get("data") or {}).get("data") or {}
        entry = m.get("LOGIN_GO2") or m.get("LOGIN_GO") or ""
    except Exception as e:
        return False, f"门户接口异常：{e}"
    if not entry:
        return False, "门户未返回登录入口（统一认证会话可能已失效）"
    try:
        http.get(UPSTREAM + "/r/or?" + entry + "&oauthName=ssologins&f=0",
                 timeout=TIMEOUT, allow_redirects=True)
    except Exception as e:
        return False, f"门户登录失败：{e}"
    return True, ""


def portal_login(user, db, http, captcha_text: str = "") -> tuple:
    """服务端完成门户登录；返回 (True, "") 或 (False, 原因)，需要人工验证码时返回 NEED_CAPTCHA"""
    ok, why = _cas_session(user, db, http)
    if not ok and why == "NEED_LOGIN":
        ok, why = _fresh_cas_login(user, db, captcha_text)
    if not ok:
        return False, why
    return _portal_oauth(http)


def _logged_flag(user_id: int, value=None):
    """该用户的门户是否已登录（内存标记，会话失效时会由 CAS 跳转检测触发重登）"""
    with _lock:
        c = _clients.get(user_id)
        if c is None:
            return False
        if value is None:
            return bool(c.get("logged_in"))
        c["logged_in"] = bool(value)
        return bool(value)


def _login_page(origin: str, reason: str) -> HTMLResponse:
    """服务端自动登录失败时的提示页（需要人工验证码时给出手输入口）"""
    need = reason == "NEED_CAPTCHA"
    body = "<p>服务端未能自动登录信息门户（" + html_mod.escape(reason) + "）。</p>"
    if need:
        body = ("<p>统一认证需要验证码，自动识别没成功。点下面按钮手输一次即可（只影响这一次登录）。</p>"
                '<p><a href="' + origin + PREFIX + '/manual">去输入验证码</a></p>')
    return _page("信息门户登录失败", body + "<p>若反复失败，可先回校园服务重新连接校园网。</p>", origin)


def _tunnel_alive(http) -> bool:
    """隧道是否真的通：容器刚重建、tun0 还没起来时，状态可能已显示 connected，
    这时所有请求都会干等超时，所以先做一次短超时探活，快速给出提示而不是让用户白等。"""
    try:
        http.get(UPSTREAM + "/", timeout=PROBE_TIMEOUT, allow_redirects=False)
        return True
    except requests.exceptions.RequestException:
        return False


def _is_cas_redirect(up) -> bool:
    """上游跳向统一认证 = 门户会话没了（需要服务端重登）"""
    loc = up.headers.get("Location") or ""
    return up.status_code in (301, 302, 303, 307, 308) and "authserver.sit.edu.cn" in loc


def _replay_cookies(http, resp, origin: str):
    """把服务端会话里的门户/CAS Cookie 回灌给浏览器：门户引导页会读 document.cookie 判断登录态，
    不灌的话它自己又要跳一次 CAS（那边 500）。"""
    for c in list(http.cookies):
        if not c.domain or not c.domain.endswith("sit.edu.cn"):
            continue
        path = c.path or "/"
        if not path.startswith(PREFIX):
            path = PREFIX + (path if path.startswith("/") else "/" + path)
        if not c.domain.startswith("authserver.") and not path.startswith(PREFIX):
            continue
        safe = (c.value or "").replace('"', "")
        cookie = f"{c.name}={safe}; Path={path}; HttpOnly; SameSite=Lax"
        resp.raw_headers.append((b"set-cookie", cookie.encode("latin-1", "ignore")))

@router.get("/api/sit/manual", tags=["校园服务"])
def sit_manual_login(request: Request, captcha: str = "", db: OrmSession = Depends(get_db)):
    """人工验证码入口：服务端自动登录需要人眼识别时用（只影响这一次登录）"""
    origin = f"{request.url.scheme}://{request.headers.get('host', 'anticraft.top')}"
    token = request.cookies.get(COOKIE_NAME)
    user = get_optional_user(token, db) if token else None
    if user is None:
        return _page("需要先登录 anticraft", "<p>请从 anticraft App 内打开信息门户。</p>", origin, 401)
    endpoint = _socks_endpoint(user.id)
    if endpoint is None:
        return _page("校园网未连接", "<p>请先回到校园服务连接校园网，再试一次。</p>", origin)
    http = _upstream_session(user.id, endpoint[0], endpoint[1])
    if captcha.strip():
        ok, why = portal_login(user, db, http, captcha.strip())
        if ok:
            _logged_flag(user.id, True)
            return RedirectResponse(PREFIX + "/", status_code=302)
        return _login_page(origin, why)
    from features.campus_service import _b64, _get_managers
    try:
        m = _get_managers()
        campus = m["sessions"].get(user.id)
        dekt = m["dekt"].get(user.id, campus)
        pending = dekt.prepare_login(campus.student_id, campus.password)
    except Exception as e:
        return _login_page(origin, f"取验证码失败：{e}")
    if pending is None or not pending.captcha:
        return RedirectResponse(PREFIX + "/", status_code=302)
    body = ('<p>输入图中验证码即可完成登录（只这一次需要手输）：</p>'
            f'<p><img src="data:image/png;base64,{_b64(pending.captcha)}" alt="captcha" '
            'style="border:1px solid #ddd;background:#fff"/></p>'
            f'<form method="get" action="{PREFIX}/manual">'
            '<input name="captcha" autocomplete="off" autocapitalize="off" '
            'style="font-size:18px;padding:6px 10px;width:140px" /> '
            '<button type="submit" style="padding:6px 14px;cursor:pointer">登录</button></form>')
    return _page("统一认证验证码", body, origin)

@router.get("/api/sit/connect", tags=["校园服务"])
def sit_connect(request: Request, db: OrmSession = Depends(get_db)):
    """门户侧一键连接校园网：触发后端既有连接流程，连上后自动跳回门户"""
    origin = f"{request.url.scheme}://{request.headers.get('host', 'anticraft.top')}"
    token = request.cookies.get(COOKIE_NAME)
    user = get_optional_user(token, db) if token else None
    if user is None:
        return _page("需要先登录 anticraft", "<p>请从 anticraft App 内打开信息门户。</p>", origin, 401)
    try:
        from features.campus_service import _decrypt_or_400, _get_managers, _load_cred
        m = _get_managers()
        sess = m["sessions"].get(user.id)
        if sess is None or sess.status == "failed":
            cred = _load_cred(user, db)
            m["sessions"].create(user.id, cred.student_id, _decrypt_or_400(cred.vpn_password_enc))
            sess = m["sessions"].get(user.id)
    except Exception as e:
        return _page("连接失败", f"<p>{html_mod.escape(str(e))}</p>", origin)
    status = sess.status if sess else "creating"
    if status == "connected":
        return RedirectResponse(PREFIX + "/", status_code=302)
    return _page("正在连接校园网",
                 f"<p>学校侧建立隧道通常要 40~90 秒，本页会自动刷新。</p><p>当前状态：{status}</p>",
                 origin, refresh=8)
