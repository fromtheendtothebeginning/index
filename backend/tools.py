# tools.py — 视频工具：视频解析与下载（yt-dlp）

import os
import shutil
import tempfile
import threading
import time

_DOWNLOAD_DIR = os.path.join(tempfile.gettempdir(), "anticraft_tools")
os.makedirs(_DOWNLOAD_DIR, exist_ok=True)

# 并发下载限制：同时最多 1 个下载（防耗尽服务器带宽/磁盘）
_download_slot = threading.BoundedSemaphore(1)


def _patch_bilibili_headers():
    """绕 B 站对数据中心 IP 的 412 风控：剥离 Referer/Origin + 网页 412 用 view API 构造 initial_state。

    B 站对数据中心 IP 带 Referer/Origin 的请求返回 412；wbi/view/detail 恒风控(-352)；
    但 x/web-interface/view 纯 UA 可正常访问（200）。故：
    1) 移除各提取器类 _HEADERS 的 Referer/Origin，并剥离内联请求头；
    2) 网页 HTML 抓取遇 412 时，用纯 UA 调 view API 拿 videoData，构造含
       window.__INITIAL_STATE__ 的假网页返回，让 yt-dlp 走正常解析分支。
    """
    import json as _json
    import re as _re
    import types as _types
    import urllib.request as _ur
    from yt_dlp.extractor import bilibili as _bili_mod

    _UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

    def _view_via_api(url):
        """从视频 URL 提取 bvid，用纯 UA 调 x/web-interface/view 返回 videoData dict"""
        m = _re.search(r'BV[0-9A-Za-z]+', url)
        if not m:
            return None
        bvid = m.group(0)
        api = f'https://api.bilibili.com/x/web-interface/view?bvid={bvid}'
        req = _ur.Request(api, headers={'User-Agent': _UA})
        try:
            with _ur.urlopen(req, timeout=20) as r:
                data = _json.loads(r.read().decode())
            if data.get('code') == 0 and data.get('data'):
                return data['data']
        except Exception:
            return None
        return None

    patched = 0
    for cls_name in dir(_bili_mod):
        obj = getattr(_bili_mod, cls_name)
        if not (isinstance(obj, type) and hasattr(obj, "_HEADERS")):
            continue
        if isinstance(obj._HEADERS, dict) and any(k in obj._HEADERS for k in ("Referer", "Origin")):
            obj._HEADERS = {k: v for k, v in obj._HEADERS.items() if k not in ("Referer", "Origin")}
            patched += 1
        # 包装下载方法：剥离内联 Referer/Origin；网页 412 → view API 构造 initial_state 假网页
        if not getattr(obj, "_anticraft_patched", False):
            _orig_dj = obj._download_json
            _orig_dwh = obj._download_webpage_handle

            def _clean_headers(headers):
                if isinstance(headers, dict):
                    return {k: v for k, v in headers.items() if k not in ("Referer", "Origin")}
                return headers

            def _dj(self, url, *args, **kwargs):
                kwargs["headers"] = _clean_headers(kwargs.get("headers"))
                return _orig_dj(self, url, *args, **kwargs)

            def _dwh(self, url, *args, **kwargs):
                kwargs["headers"] = _clean_headers(kwargs.get("headers"))
                try:
                    return _orig_dwh(self, url, *args, **kwargs)
                except Exception as e:
                    if "412" not in str(e) and "Precondition" not in str(e):
                        raise
                    orig_url = url if isinstance(url, str) else (getattr(url, "url", "") or "")
                    video_data = _view_via_api(orig_url)
                    fake = _types.SimpleNamespace(url=orig_url)
                    if video_data:
                        # 构造含 __INITIAL_STATE__ 的假网页，yt-dlp 后续走正常解析
                        fake_html = (
                            '<script>window.__INITIAL_STATE__ = '
                            + _json.dumps({'videoData': video_data}, ensure_ascii=False)
                            + '</script>'
                        )
                        return fake_html, fake
                    return "", fake

            obj._download_json = _dj
            obj._download_webpage_handle = _dwh
            obj._anticraft_patched = True
            patched += 1
    return patched


def _cleanup_old_dirs():
    """清理 24 小时前的临时下载目录"""
    now = time.time()
    for name in os.listdir(_DOWNLOAD_DIR):
        p = os.path.join(_DOWNLOAD_DIR, name)
        try:
            if os.path.isdir(p) and now - os.path.getmtime(p) > 86400:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass


_cleanup_old_dirs()


def _ydl_opts(download_dir=None):
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 20,
        # 浏览器 UA 即可；勿带 Referer —— 数据中心 IP 带 Referer 请求 B 站会触发 412 风控
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
    }
    # 可选：环境变量配置 B 站 Cookie（登录态可绕过数据中心 IP 的 412 风控）
    bili_cookie = os.getenv("BILIBILI_COOKIE")
    if bili_cookie:
        opts["cookiefile"] = None
        opts["cookiejar"] = _build_cookiejar(bili_cookie)
    if download_dir:
        opts.update({
            "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
            "merge_output_format": "mp4",
            "outtmpl": os.path.join(download_dir, "%(title).80B.%(ext)s"),
        })
    return opts


def _build_cookiejar(cookie_str: str) -> str:
    """把 'k=v; k2=v2' 形式的 Cookie 字符串写成 Netscape 格式 cookie 文件，返回文件路径"""
    import tempfile
    import time as _time
    lines = ["# Netscape HTTP Cookie File"]
    for pair in cookie_str.split(";"):
        pair = pair.strip()
        if "=" in pair:
            name, _, value = pair.partition("=")
            lines.append(
                f".bilibili.com\tTRUE\t/\tTRUE\t{int(_time.time()) + 86400 * 180}\t{name.strip()}\t{value.strip()}"
            )
    fd = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    fd.write("\n".join(lines) + "\n")
    fd.close()
    return fd.name


def extract_video_info(url: str) -> dict:
    """提取视频信息（不下载）。返回精简字段，供解析工具展示。"""
    _patch_bilibili_headers()
    from yt_dlp import YoutubeDL
    with YoutubeDL(_ydl_opts()) as ydl:
        info = ydl.extract_info(url, download=False)
    formats = info.get("formats") or []
    res = {}
    for f in formats:
        h = f.get("height")
        if h and f.get("url"):
            res.setdefault(h, {
                "height": h,
                "ext": f.get("ext"),
                "size": f.get("filesize") or f.get("filesize_approx"),
            })
    # 封面归一化为 https（明文 http 会被前端 CSP img-src 拦截）
    thumb = info.get("thumbnail") or ""
    if thumb.startswith("http://"):
        thumb = "https://" + thumb[7:]
    return {
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "duration": info.get("duration"),  # 秒
        "thumbnail": thumb or None,
        "webpage_url": info.get("webpage_url") or url,
        "formats": sorted(res.values(), key=lambda x: x["height"], reverse=True)[:12],
    }


def download_video(url: str, progress_cb=None) -> tuple[str, str]:
    """下载视频到临时目录，返回 (文件路径, 文件名)。并发限制 1。失败抛异常。
    progress_cb: 可选回调，接收 0-99 的整数进度（yt-dlp 下载阶段实时回调）"""
    tmp = tempfile.mkdtemp(prefix="anticraft_tool_", dir=_DOWNLOAD_DIR)
    try:
        opts = _ydl_opts(tmp)
        if progress_cb:
            def _hook(d):
                if d.get("status") == "downloading":
                    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                    done = d.get("downloaded_bytes") or 0
                    if total:
                        progress_cb(min(99, int(done / total * 100)))
            opts["progress_hooks"] = [_hook]
        with _download_slot:
            _patch_bilibili_headers()
            from yt_dlp import YoutubeDL
            with YoutubeDL(opts) as ydl:
                ydl.download([url])
        files = [f for f in os.listdir(tmp) if not f.endswith((".part", ".ytdl", ".tmp"))]
        if not files:
            raise RuntimeError("下载失败：未生成文件")
        return os.path.join(tmp, files[0]), files[0]
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def cleanup_download_dir(dirname: str):
    """后台清理下载产物目录"""
    shutil.rmtree(dirname, ignore_errors=True)