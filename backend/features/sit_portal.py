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
    return _HOST_NAV_RE.sub('"' + origin + PREFIX + '/r/', text)


def _rewrite_location(value: str, origin: str) -> str:
    """Location 改写；但指向 CAS 的一律原样透传 —— 学校 CAS 对 OAuth 回调地址做白名单校验
    （实测报「传递的 redirect_uri 跟注册的回调地址不匹配」），改写就会被拒；
    登录后浏览器会被送到真实的 portal.sit.edu.cn，由 App 在导航层映射回代理。"""
    if "authserver.sit.edu.cn" in value:
        return value
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

def _page(title: str, body: str, origin: str, status_code: int = 200) -> HTMLResponse:
    title = html_mod.escape(title)
    safe_origin = html_mod.escape(origin)
    html = f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{title}</title>
<style>body{{margin:0;padding:32px 20px;font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;
background:#f8f9fa;color:#222}}h1{{font-size:18px;margin:0 0 12px}}p{{margin:0 0 10px;color:#555}}
a{{color:#6c5ce7}}</style></head><body><h1>{title}</h1>{body}
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
                     "<p>信息门户只在校园网内可达。请先回到校园服务连接校园网，再点「信息门户」。</p>",
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
    try:
        up = sess.request(request.method, upstream_url, headers=headers, data=body,
                          allow_redirects=False, stream=True, timeout=TIMEOUT)
    except requests.exceptions.RequestException as e:
        return _page("门户连接失败",
                     f"<p>经校园网访问信息门户失败：{type(e).__name__}。请确认校园网连接正常后重试。</p>",
                     origin)

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
    return resp
