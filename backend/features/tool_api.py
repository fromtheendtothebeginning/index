# features/tool_api.py — 视频工具 API（视频解析与下载，需登录）

import ipaddress
import os
import secrets
import socket
import threading
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask

import tools

from deps import _log, get_current_user_obj
from models import User

router = APIRouter()


def _require_http_url(url: str) -> str:
    """校验工具 URL：必须以 http:// 或 https:// 开头，且非内网地址（防 SSRF/任意文件读取）"""
    if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL 必须为 http:// 或 https:// 开头",
        )
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL 无效")
    lowered = host.lower().rstrip(".")
    if lowered in ("localhost", "localhost.localdomain") or lowered.endswith((".localhost", ".local")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许访问内网地址")
    try:
        ip = ipaddress.ip_address(lowered)
        if not ip.is_global:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许访问内网地址")
    except ValueError:
        try:
            resolved = socket.gethostbyname(host)
            if not ipaddress.ip_address(resolved).is_global:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许访问内网地址")
        except HTTPException:
            raise
        except OSError:
            pass  # 域名解析失败交由 yt-dlp 处理
    return url


_THUMB_ALLOW_HOSTS = ("hdslb.com", "bilibili.com", "ytimg.com", "youtube.com", "akamaized.net", "img.youtube.com", "youtu.be")


def _thumb_host_allowed(host: str) -> bool:
    return any(host == h or host.endswith("." + h) for h in _THUMB_ALLOW_HOSTS)


@router.get("/api/tools/video/info", tags=["工具"])
def video_info(
    url: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """解析视频信息（不下载，需登录）"""
    _require_http_url(url)
    _log(f"video/info by {current_user.username} : {url[:80]}")
    try:
        info = tools.extract_video_info(url)
    except Exception:
        _log("video/info FAILED: " + url[:80])
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法解析该视频链接",
        )
    _log(f"video/info OK: 「{info.get('title', '')[:40]}」 {info.get('duration', 0)}s")
    return {"ok": True, "info": info}


@router.get("/api/tools/video/download", tags=["工具"])
def video_download(
    url: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """下载视频为 mp4（需登录，单并发；响应完成后自动清理临时文件）"""
    _require_http_url(url)
    try:
        path, filename = tools.download_video(url)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="下载失败，请稍后重试",
        )
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=filename,
        background=BackgroundTask(tools.cleanup_download_dir, os.path.dirname(path)),
    )


# 下载任务（后端 yt-dlp 实时进度 → 前端轮询）
_dl_lock = threading.Lock()
_dl_tasks = {}  # task_id -> {progress, status, path, filename, error}


@router.post("/api/tools/video/download-task", tags=["工具"])
def video_download_task(
    req: dict,
    current_user: User = Depends(get_current_user_obj),
):
    """创建下载任务，后台 yt-dlp 下载并实时更新进度（需登录）
    mode: merged/video_only/audio_only/separate（见 tools.download_video）"""
    url = (req.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入视频链接")
    mode = (req.get("mode") or "merged").strip()
    if mode not in ("merged", "video_only", "audio_only", "separate"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未知的下载模式")
    _require_http_url(url)
    task_id = secrets.token_urlsafe(16)
    task = {"progress": 0, "status": "downloading", "path": None, "filename": None, "files": None, "error": None}
    with _dl_lock:
        _dl_tasks[task_id] = task
    _log(f"download-task created by {current_user.username} [{mode}] : {url[:60]} -> {task_id[:8]}")

    def _run():
        try:
            # progress 只增不减：yt-dlp 对音视频分离的源会分多路下载（视频流+音频流），
            # 每路的 progress_hooks 独立 0-100，直接覆盖会让进度条走完一遍又从 0 走一遍
            results = tools.download_video(
                url,
                mode=mode,
                progress_cb=lambda p: task.__setitem__("progress", max(task["progress"], p)),
            )
            task["files"] = results  # [(path, filename), ...]
            task["path"] = results[0][0]
            task["filename"] = results[0][1]
            task["status"] = "done"
            _log(f"download-task done [{mode}]: {len(results)} file(s)")
        except Exception as exc:
            task["status"] = "failed"
            task["error"] = str(exc)[:200]
            _log(f"download-task FAILED [{mode}]: {str(exc)[:120]}")

    threading.Thread(target=_run, daemon=True).start()
    return {"task_id": task_id}


@router.get("/api/tools/video/download-progress", tags=["工具"])
def video_download_progress(
    task_id: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """查询下载任务进度（前端轮询）"""
    task = _dl_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return {"progress": task["progress"], "status": task["status"], "error": task.get("error")}


@router.get("/api/tools/video/download-file", tags=["工具"])
def video_download_file(
    task_id: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """下载任务完成后获取文件（需登录）。多文件（separate 模式）打包为 zip 返回。"""
    task = _dl_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if task["status"] != "done":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="任务尚未完成")
    files = task["files"] or [(task["path"], task["filename"])]
    with _dl_lock:
        _dl_tasks.pop(task_id, None)

    if len(files) == 1:
        path, filename = files[0]
        media_type = "video/mp4" if filename.lower().endswith((".mp4", ".mkv", ".webm", ".m4v")) else (
            "audio/mpeg" if filename.lower().endswith((".mp3", ".m4a")) else "application/octet-stream"
        )
        return FileResponse(
            path,
            media_type=media_type,
            filename=filename,
            background=BackgroundTask(tools.cleanup_download_dir, os.path.dirname(path)),
        )

    # 多文件：打包 zip（不随响应删除，交给前端下载后由清理任务处理）
    import zipfile
    zpath = os.path.join(os.path.dirname(files[0][0]), "download.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, filename in files:
            zf.write(path, filename)
    return FileResponse(
        zpath,
        media_type="application/zip",
        filename="download.zip",
        background=BackgroundTask(tools.cleanup_download_dir, os.path.dirname(zpath)),
    )


@router.get("/api/tools/thumb", tags=["工具"])
def tool_thumb(
    url: str = Query(...),
    current_user: User = Depends(get_current_user_obj),
):
    """代理视频封面图（绕过防盗链/临时 URL 过期），仅允许图片 CDN 域名，需登录"""
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if not _thumb_host_allowed(host):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不允许的图片域名")
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片 URL 无效")
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://www.bilibili.com/",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "image/jpeg")
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片获取失败")
    return Response(content=data, media_type=ctype)
