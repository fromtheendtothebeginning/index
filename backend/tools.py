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
    }
    if download_dir:
        opts.update({
            "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
            "merge_output_format": "mp4",
            "outtmpl": os.path.join(download_dir, "%(title).80B.%(ext)s"),
        })
    return opts


def extract_video_info(url: str) -> dict:
    """提取视频信息（不下载）。返回精简字段，供解析工具展示。"""
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