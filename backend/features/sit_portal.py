# features/sit_portal.py — SIT 信息门户（portal.sit.edu.cn）反向代理：流量经服务器校园网隧道
#
# 为什么需要：portal.sit.edu.cn 只在校园网内可达（公网直连超时），手机直连必然失败。
# 这里把门户反代到 /api/sit/ 下（nginx 已把 /api/ 转给后端，不用改 nginx），
# 上游请求走【该用户自己的】VPN 会话 SOCKS —— 门户是个人数据，按项目约定不走共享池。
#
# 登录：由服务端代登录 —— 后端用该用户的统一认证(CAS)会话把门户 OAuth 跑完（见文件末尾
# 「服务端登录」一节），门户登录态存在服务端会话的 Cookie 罐里，浏览器完全不碰 CAS。
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
LOGIN_RETRY_COOLDOWN = 60                           # 登录失败后的静默期（秒），见 _login_cooldown_reason
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
# url(...) 前面不能是标识符字符：JS 里的 delayURL(...)、getURL(...) 尾巴会被误当成 CSS url()
# （门户框架页的 delayURL(delay) 就这样被改成 delayurl(/api/sit/r/delay)，整段内联脚本语法错误）
_CSS_URL_RE = re.compile(r"""(?<![A-Za-z0-9_])url\(\s*(['"]?)([^'")]+)\1\s*\)""", re.I)
_SCRIPT_BLOCK_RE = re.compile(r"(<script\b[^>]*>.*?</script>)", re.I | re.S)
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
                # 根相对：门户框架会从 <script src> 反推「启动路径」再拼接资源，
                # 若这里给绝对地址，它会拼成 /api/sit/apps/https://... 而 403
                return PREFIX + abs_url[len(scheme) + len(host):]
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
        return PREFIX + r
    return _map_abs(urljoin(base_url, r), origin)   # 相对 → 按原始 URL 解析后映射


def _rewrite_css_urls(text: str, base_url: str, origin: str) -> str:
    """改写 CSS 的 url(...)，但**跳过 <script> 块**：那里的 url(/URL( 是 JS（new URL(...)、
    delayURL(...) 之类），按 CSS 处理会把函数调用改坏（框架页 delayURL 就是这么被改坏的）。"""
    def one(chunk):
        return _CSS_URL_RE.sub(
            lambda m: "url(" + m.group(1) + _map_ref(m.group(2), base_url, origin) + m.group(1) + ")",
            chunk)
    return "".join(one(p) if i % 2 == 0 else p
                   for i, p in enumerate(_SCRIPT_BLOCK_RE.split(text)))


def _rewrite_html(text: str, base_url: str, origin: str) -> str:
    def attr(m):
        return m.group(1) + m.group(2) + _map_ref(m.group(3), base_url, origin) + m.group(2)
    text = _ATTR_RE.sub(attr, text)
    text = _rewrite_css_urls(text, base_url, origin)
    return _rewrite_scripts(text, origin)


def _rewrite_css(text: str, base_url: str, origin: str) -> str:
    return _CSS_URL_RE.sub(
        lambda m: "url(" + m.group(1) + _map_ref(m.group(2), base_url, origin) + m.group(1) + ")",
        text)


def _rewrite_scripts(text: str, origin: str) -> str:
    """脚本/JSON 里的站点地址：改成我们域的绝对地址（new URL() 之类也能用）"""
    # 一层 "../commons/…"（public.js 用 document.write 写 <script src>、url()、img src）
    # 在真站靠浏览器在站点根钳位解析，加前缀后会掉到 /api/commons → 改写成前缀绝对地址。
    # 两层以上（app 目录 awsui.js 里的 "../../../commons/…"）是门户 loader 的模块路径，
    # 会与 bootPATH 做字符串拼接（loadjs: bootPATH + b），必须保持相对：前缀恰好两段，
    # 归一化后正好落在 /api/sit/commons/…；改成绝对地址会被拼成 /api/sit/apps/https://… 而 403。
    text = re.sub(r"""(["'(])\.\./(?!\.\./)commons/""",
                  lambda m: m.group(1) + PREFIX + "/commons/", text)
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
    text = _HOST_NAV_RE.sub('"' + PREFIX + '/r/', text)
    # 服务端已经登录了：把「没 ck_ 就跳 OAuth/CAS」的分支改成直接走已登录入口，
    # 否则引导页会自己跳一次 CAS（那边会落到坏 worker 报 500）
    return _SSO_BRANCH_RE.sub("u = './r/w?'+u;", text)


def _rewrite_asset_bytes(raw: bytes) -> bytes:
    """JS/CSS/JSON 体：只做字节级 URL 前缀化（调用处说明为什么绝不转码）"""
    out = raw
    for h in UPSTREAM_HOSTS:
        hb = h.encode()
        out = out.replace(b"https://" + hb, PREFIX.encode())
        out = out.replace(b"http://" + hb, PREFIX.encode())
        out = out.replace(b"//" + hb, PREFIX.encode())
        out = out.replace(hb, PREFIX.lstrip("/").encode())
    # 一层 "../commons/…" 是文档相对引用（document.write 的 <script src>、url()、img src），
    # 真站靠浏览器在站点根钳位；两层以上（app 目录 awsui.js 的 "../../../commons/…"）是 loader 的
    # 模块路径，会与 bootPATH 做字符串拼接，必须保持相对才能归一化到 /api/sit/commons/…
    return re.sub(rb"(?<!\.\./)\.\./commons/", (PREFIX + "/commons/").encode(), out)


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
    return HTMLResponse(html, status_code=status_code,
                        headers={"Cache-Control": "no-store, max-age=0"})


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

    # 3) 转发（不跟随跳转，自己改写 Location；最多两跳：第一跳判定要不要服务端登录，
    #    登录成功后再取一次）
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

    # 3) 取上游响应：第一跳判定要不要服务端登录，登录成功后再取一次
    for attempt in range(2):
        try:
            up = fetch()
        except requests.exceptions.RequestException as e:
            why = "重试访问门户失败" if attempt else "经校园网访问信息门户失败"
            return _page("门户连接失败",
                         f"<p>{why}：{type(e).__name__}。请确认校园网连接正常后重试。</p>", origin)
        content_type = up.headers.get("Content-Type", "")
        raw = None
        if up.status_code != 304 and _is_text(content_type):
            raw = up.raw.read(MAX_BYTES + 1, decode_content=True)   # 登录判定要看正文
            up.close()
        if len(raw or b"") > MAX_BYTES:
            return _page("响应过大", "<p>该请求的响应体超过 30MB，已停止转发。</p>", origin, 502)
        if attempt or not _need_login(up, sess, content_type, raw):
            break
        up.close()
        cooling = _login_cooldown_reason(user.id)
        if cooling:
            return _login_page(origin, cooling)
        if not _tunnel_alive(sess):
            return _page("校园网隧道还没就绪",
                         "<p>校园服务显示已连接，但隧道尚未真正建立（学校侧建立隧道通常要 40~90 秒，"
                         "刚连上马上点就会这样）。</p><p>请等约 30 秒再点一次「信息门户」；"
                         "若一直如此，回校园服务断开后重连一次。</p>", origin)
        ok, why = portal_login(user, db, sess)
        if not ok:
            _mark_login_failed(user.id, why)
            if why == "NEED_CAPTCHA":       # 直接送到手输页：账号密码已填好，只填验证码
                return RedirectResponse(PREFIX + "/manual", status_code=302)
            return _login_page(origin, why)

    # 4) 响应头
    out_headers = {k: v for k, v in up.headers.items() if k.lower() not in _DROP_RESP_HEADERS}
    if "Location" in up.headers:
        out_headers["Location"] = _rewrite_location(up.headers["Location"], origin)
    cookies = up.raw.headers.getlist("set-cookie") if hasattr(up.raw.headers, "getlist") else []

    # 5) 文本体改写（HTML/CSS/JS/JSON），其余原样透传
    if raw is not None:
        if "html" in content_type:
            # HTML：门户的页面是带 BOM 的 UTF-8，解码改写后统一按 utf-8 输出
            declared = (re.search(r"charset=([\w\-]+)", content_type, re.I) or [None, ""])[1]
            text = _rewrite_html(_decode_body(raw, declared), upstream_url, origin)
            out_headers["Content-Type"] = "text/html; charset=utf-8"
            resp = Response(content=text.encode("utf-8"),
                            status_code=up.status_code, headers=out_headers, media_type=None)
        else:
            # JS/CSS/JSON：门户这些文件是 **GBK** 且 Content-Type 不写 charset，
            # 一旦按 utf-8/gbk 解码再转码，二进制字节（GBK 的 0x5C 陷阱）会破坏脚本语法
            # → awsui/public.js 整块不执行、引导页空白。所以只做**字节级**替换，绝不转码。
            out = _rewrite_asset_bytes(raw)
            # 门户这些文件是 GBK 但 Content-Type 不带 charset，浏览器会按文档的 UTF-8 解析 → 语法错误。
            # 按内容判断：不是合法 UTF-8 就显式声明 GBK（Chromium 认识 GBK）。
            if "charset=" not in content_type.lower():
                try:
                    out.decode("utf-8")
                except UnicodeDecodeError:
                    out_headers["Content-Type"] = content_type + "; charset=GBK"
            resp = Response(content=out, status_code=up.status_code,
                            headers=out_headers, media_type=None)
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


def _fresh_cas_login(user, db, http, captcha_text: str = "", force: bool = False) -> tuple:
    """现场做一次统一认证登录：captcha_text 为空时先取验证码（有 AI 识图就自动解）。
    force=True 表示复用路径刚失败，内存里的 CAS 会话已失效，必须清掉重新登。
    返回 (True, "") / (False, "NEED_CAPTCHA") / (False, 原因)"""
    from features.campus_service import _ai_solve_captcha, _b64, _get_managers, _resolve_vision_model
    try:
        m = _get_managers()
        campus = m["sessions"].get(user.id)
        if not campus or campus.status != "connected":
            return False, "校园网未连接"
        dekt = m["dekt"].get(user.id, campus)
        if force:
            dekt.session = None
        # 用户是看着页面上那张验证码输入的 → 必须沿用同一个待完成会话：
        # 再调一次 prepare_login 会重新取图，用户手里那张当场作废（旧的手输页就栽在这里，
        # 表现成「输了验证码也没反应」）。
        if captcha_text:
            if dekt.pending is None:
                return False, "验证码已失效，请重新输入"
            pending = dekt.pending
        else:
            pending = dekt.prepare_login(campus.student_id, campus.password)
    except Exception as e:
        return False, f"统一认证登录失败：{e}"
    if pending is None:                     # 已有 CAS 会话（校园服务里刚登过）
        return _copy_cas_cookies(dekt, http)
    text = (captcha_text or "").strip()
    auto = not text                         # AI 识别的验证码可能是错的，失败要给手输入口
    if auto:
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
        return False, "NEED_CAPTCHA" if auto else f"统一认证登录失败：{e}"
    # 关键：刚拿到的 CAS Cookie 必须装进上游会话，否则门户 OAuth 会悄悄退回统一认证登录页
    return _copy_cas_cookies(dekt, http)


def _portal_oauth(http) -> tuple:
    """带着 CAS 会话把门户 OAuth 跑完（服务端跟随跳转），成功即门户会话落在 http 的 Cookie 罐里。
    最后必须拿已登录入口验一次：CAS 会话失效时门户会悄悄退回统一认证登录页（HTTP 200），
    只看「有没有抛异常」会把这种失败当成功，然后界面就一直卡在门户的 401 错误页上。"""
    hdr = {"Referer": UPSTREAM + "/", "Origin": UPSTREAM}
    try:
        # 必须先取一次门户首页：门户自己的初始 cookie（CSRF-TOKEN 等）不拿到，
        # 后面 OAuth 走完也不会建立门户会话（/r/w 会返回「未授权被拒绝(401)」）
        http.get(UPSTREAM + "/", timeout=TIMEOUT, headers=hdr)
        r = http.post(UPSTREAM + "/r/jd?cmd=com.awspaas.user.apps.onlineoffice_getDefSSO",
                      data={"yu": UPSTREAM}, timeout=TIMEOUT,
                      headers={"Content-Type": "application/x-www-form-urlencoded", **hdr})
        m = ((r.json() or {}).get("data") or {}).get("data") or {}
        entry = m.get("LOGIN_GO2") or m.get("LOGIN_GO") or ""
    except Exception as e:
        return False, f"门户接口异常：{e}"
    if not entry:
        return False, "门户未返回登录入口（统一认证会话可能已失效）"
    _drop_portal_cookies(http)              # 清掉上一次的（多半已失效的）门户会话 Cookie
    try:
        http.get(UPSTREAM + "/r/or?" + entry + "&oauthName=ssologins&f=0",
                 timeout=TIMEOUT, allow_redirects=True, headers=hdr)
        probe = http.get(UPSTREAM + "/r/w?" + entry, timeout=TIMEOUT, allow_redirects=False)
    except Exception as e:
        return False, f"门户登录失败：{e}"
    if _looks_logged_out(probe.content):
        return False, "门户未建立登录态（统一认证会话可能已失效）"
    return True, ""


def portal_login(user, db, http, captcha_text: str = "") -> tuple:
    """服务端完成门户登录；返回 (True, "") 或 (False, 原因)，需要人工验证码时返回 NEED_CAPTCHA"""
    ok, why = _cas_session(user, db, http)
    fresh = ok                               # 现场新登的就不用再登一次
    if not ok and why == "NEED_LOGIN":
        ok, why = _fresh_cas_login(user, db, http, captcha_text)
        fresh = ok
    if not ok:
        return False, why
    ok, why = _portal_oauth(http)
    if not ok and not fresh:
        # 复用的校园网 CAS 会话可能已经失效（内存里的会话没有过期感知）→ 清掉现场重登一次
        ok, why = _fresh_cas_login(user, db, http, captcha_text, force=True)
        if not ok:
            return False, why
        ok, why = _portal_oauth(http)
    return ok, why


def _login_cooldown_reason(user_id: int):
    """登录失败后的静默期内返回上次的失败原因（否则 None）：
    门户页面会并发拉几十个资源，不拦一下会把一次登录失败放大成几十次登录（每次都烧一次 AI 识别）。"""
    with _lock:
        c = _clients.get(user_id)
        failed = (c or {}).get("login_failed")
    if failed and time.time() - failed[0] < LOGIN_RETRY_COOLDOWN:
        return failed[1]
    return None


def _mark_login_failed(user_id: int, why: str):
    with _lock:
        c = _clients.get(user_id)
        if c is not None:
            c["login_failed"] = (time.time(), why)


def _login_page(origin: str, reason: str) -> HTMLResponse:
    """服务端自动登录失败时的提示页；无论哪种失败都给到手输入口（失败页是死胡同最难用）"""
    need = reason == "NEED_CAPTCHA"
    body = "<p>服务端未能自动登录信息门户（" + html_mod.escape(reason) + "）。</p>"
    if need:
        body = "<p>统一认证需要验证码，自动识别没成功。手输一次即可（只影响这一次登录）。</p>"
    body += ('<p><a class="btn" href="' + origin + PREFIX + '/manual">'
             '去手动登录（账号密码已填好）</a></p>'
             "<p>若反复失败，可先回校园服务重新连接校园网。</p>")
    return _page("信息门户登录失败", body, origin)


def _login_form(origin: str, username: str, password: str, captcha_b64: str,
                error: str = "") -> HTMLResponse:
    """手输登录页：账号密码预填好，只让用户填验证码（改过账号密码也能直接改，会按新的重建会话）"""
    esc = lambda v: html_mod.escape(str(v or ""), quote=True)   # noqa: E731
    body = ""
    if error:
        body += f'<p style="color:#c0392b">{esc(error)}</p>'
    body += "<p>账号密码已填好，输入图中验证码即可（只影响这一次登录）。</p>"
    if captcha_b64:
        body += (f'<p><img src="data:image/png;base64,{captcha_b64}" alt="captcha" '
                 'style="border:1px solid #ddd;background:#fff"/></p>')
    else:
        body += "<p>（这次没能取到验证码图片，可点「换一张」重试）</p>"
    body += (
        f'<form method="post" action="{PREFIX}/manual" '
        'style="max-width:320px;margin:0 auto;text-align:left">'
        '<label style="display:block;margin:8px 0 2px">账号</label>'
        f'<input name="username" value="{esc(username)}" autocomplete="off" autocapitalize="off" '
        'style="width:100%;font-size:16px;padding:6px 10px">'
        '<label style="display:block;margin:8px 0 2px">密码</label>'
        f'<input name="password" type="password" value="{esc(password)}" autocomplete="off" '
        'style="width:100%;font-size:16px;padding:6px 10px">'
        '<label style="display:block;margin:8px 0 2px">验证码</label>'
        '<input name="captcha" autocomplete="off" autocapitalize="off" '
        'style="width:150px;font-size:18px;padding:6px 10px">'
        '<p style="margin-top:16px"><button type="submit" '
        'style="padding:9px 24px;font-size:16px;cursor:pointer">登录</button>'
        f'<a href="{PREFIX}/manual" style="margin-left:14px">换一张验证码</a></p></form>')
    return _page("统一认证登录", body, origin)


@router.api_route("/api/sit/manual", methods=["GET", "POST"], tags=["校园服务"])
async def sit_manual_login(request: Request, db: OrmSession = Depends(get_db)):
    """手输登录入口：账号密码预填，只填验证码（AI 识图失败时的兜底）"""
    origin = f"{request.url.scheme}://{request.headers.get('host', 'anticraft.top')}"
    token = request.cookies.get(COOKIE_NAME)
    user = get_optional_user(token, db) if token else None
    if user is None:
        return _page("需要先登录 anticraft", "<p>请从 anticraft App 内打开信息门户。</p>", origin, 401)
    endpoint = _socks_endpoint(user.id)
    if endpoint is None:
        return _page("校园网未连接", "<p>请先回到校园服务连接校园网，再试一次。</p>", origin)
    http = _upstream_session(user.id, endpoint[0], endpoint[1])

    form = await request.form() if request.method == "POST" else {}
    captcha = (form.get("captcha") or "").strip()
    from features.campus_service import _b64, _get_managers
    try:
        m = _get_managers()
        campus = m["sessions"].get(user.id)
        dekt = m["dekt"].get(user.id, campus)
    except Exception as e:
        return _login_page(origin, f"校园服务不可用：{e}")
    username = (form.get("username") or "").strip() or campus.student_id
    password = form.get("password") or campus.password

    error = ""
    if captcha:                             # 用户填了验证码：直接用页面那张来完成登录
        ok, why = portal_login(user, db, http, captcha)
        if ok:
            return RedirectResponse(PREFIX + "/", status_code=302)
        error = why

    # 取（新）验证码渲染登录页：失败后重取一张，用户不用退回门户再点一次
    try:
        pending = dekt.prepare_login(username, password)
    except Exception as e:
        return _login_page(origin, f"取验证码失败：{e}")
    if pending is None:                     # 统一认证会话其实还有效，这次不需要验证码
        ok, why = portal_login(user, db, http)
        if ok:
            return RedirectResponse(PREFIX + "/", status_code=302)
        return _login_page(origin, why)
    return _login_form(origin, username, password,
                       _b64(pending.captcha) if pending.captcha else "", error=error)


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


def _is_text(content_type: str) -> bool:
    return any(t in (content_type or "") for t in ("text", "json", "javascript"))


def _is_doc(content_type: str) -> bool:
    """文档类响应（门户页面、awspaas 的纯文本错误页）；静态资源与接口请求不算"""
    return any(t in (content_type or "") for t in ("text/html", "text/plain"))


def _looks_logged_out(raw) -> bool:
    """认识 awspaas 会话失效页：HTTP 200 + 「未授权被拒绝(401)/用户会话不存在或已超时无效」。
    正常门户页面里没有这两句话（只有 JS 变量「用户会话已超时」，故不能只匹配「用户会话」）。"""
    if not raw:
        return False
    text = _decode_body(raw, "")
    return "未授权被拒绝" in text or "用户会话不存在" in text


def _portal_authed(http) -> bool:
    """服务端会话里是否已有门户登录态：awspaas 登录成功会下发 ck_<hash>_ck / AWSSESSIONID"""
    return any(c.name.startswith("ck_") or c.name == "AWSSESSIONID" for c in http.cookies)


def _drop_portal_cookies(http):
    """清掉门户侧上一次的登录态 Cookie；重登前不清，门户可能续用那个已经失效的会话"""
    for c in list(http.cookies):
        if (c.domain or "").endswith("portal.sit.edu.cn") and (
                c.name.startswith("ck_") or c.name in ("AWSSESSIONID", "AWS-DAJKPOID")):
            try:
                http.cookies.clear(c.domain, c.path, c.name)
            except KeyError:
                pass


def _need_login(up, sess, content_type: str, raw) -> bool:
    """要不要服务端（重新）登录门户 —— 三个信号：
    1. 上游 302 到统一认证 = 门户会话没了；
    2. 服务端会话里没有门户登录态 Cookie（这次进程里还没登录过）；
    3. 正文就是 awspaas 的「未授权被拒绝(401)」错误页（HTTP 200，上面两条都抓不到）。
    2/3 只在文档类响应上判定：静态资源与接口请求不触发，
    否则一次登录失败会被页面并发的几十个资源请求放大成几十次登录。"""
    if _is_cas_redirect(up):
        return True
    if not _is_doc(content_type):
        return False
    return _looks_logged_out(raw) or not _portal_authed(sess)


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


# ============================================================
# 路由顺序：Starlette 按注册顺序匹配，先注册的通配路由会吃掉后注册的具体路由。
# /api/sit/manual、/api/sit/connect 就曾因此完全失效（请求被当门户路径代理到
# portal.sit.edu.cn/manual，页面 200 但不干活）。这里把通配路由固定排到最后，
# 以后新增具体路由不必再关心定义位置。
# ============================================================

_PROXY_ROUTE = "/api/sit/{path:path}"
router.routes.sort(key=lambda r: getattr(r, "path", "") == _PROXY_ROUTE)
