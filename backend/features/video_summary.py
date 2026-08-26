# features/video_summary.py — 视频 AI 总结工具 v2（后台任务 + 分阶段进度）
# 管线（与 ../AntiVideo 同源思路）：yt-dlp 拉低清视频 → ffmpeg 分轨
#   音频分片 → 用户语音模型 ASR 转写（UI 可选开关）
#   均匀抽帧 → 本地 RapidOCR 识别画面文字（SequenceMatcher 去重，阈值 0.9）
# → 主模型融合生成 Markdown 总结。字幕仅作下载失败时的降级路径。
# 全部子进程带 CREATE_NO_WINDOW：父进程为 pythonw 时避免反复弹黑窗。

import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import urllib.request
from difflib import SequenceMatcher

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Session

import aisettings
import tools as video_tools
from database import Base, SessionLocal, get_db
from deps import get_current_user_obj, _log
from models import AiKey, AiSetting, User

router = APIRouter()

# 成本与体量护栏
_MAX_TRANSCRIPT_CHARS = 24000   # 转录长度上限（超出头 80% + 尾 20% 截断）
_MAX_VIDEO_SECONDS = 5400       # 超过 90 分钟拒绝处理，防止失控费用
_ASR_CHUNK_SECONDS = 600        # 音频分片时长（每片 ≤10 分钟，规避接口体积限制）
_OCR_MAX_FRAMES = 90            # 抽帧上限（每 max(10s, 时长/90) 一帧）
_AI_TIMEOUT = 300               # 单次模型调用超时
_BROWSER_UA = aisettings._BROWSER_UA
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0

_SUB_LANGS = ["zh-Hans", "zh-CN", "zh", "ai-zh", "en"]

_ocr_engine = None


class VideoSummaryRecord(Base):
    """视频 AI 总结历史记录 —— 每用户最多保留 20 条（模型定义在功能文件内，随 create_all 建表）"""
    __tablename__ = "video_summaries"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(10), nullable=False, default="done")
    title = Column(String(300), nullable=True)
    uploader = Column(String(100), nullable=True)
    duration = Column(Integer, nullable=True)
    url = Column(String(500), nullable=True)
    source = Column(String(30), nullable=True)
    model = Column(String(100), nullable=True)
    transcript_chars = Column(Integer, nullable=False, default=0, server_default="0")
    truncated = Column(Integer, nullable=False, default=0, server_default="0")
    summary_md = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class VideoSummaryActive(Base):
    """每用户当前进行中的任务（退出重进可恢复进度）"""
    __tablename__ = "video_summary_active"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    task_id = Column(String(24), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


def _save_history(user_id, **fields):
    """后台线程写历史：插入一条并裁剪到最近 20 条；同时清理 active 标记"""
    try:
        db = SessionLocal()
        try:
            db.add(VideoSummaryRecord(user_id=user_id, **fields))
            db.commit()
            # 裁剪：每用户最多 20 条
            ids = [r.id for r in db.query(VideoSummaryRecord.id)
                   .filter(VideoSummaryRecord.user_id == user_id)
                   .order_by(VideoSummaryRecord.created_at.desc()).limit(100).all()]
            if len(ids) > 20:
                db.query(VideoSummaryRecord).filter(
                    VideoSummaryRecord.user_id == user_id,
                    VideoSummaryRecord.id.in_(ids[20:]),
                ).delete(synchronize_session=False)
            # 清 active
            db.query(VideoSummaryActive).filter(VideoSummaryActive.user_id == user_id).delete()
            db.commit()
        finally:
            db.close()
    except Exception as e:
        _log(f"video-summary save_history error: {str(e)[:120]}")


def _get_ocr_engine():
    """本地 RapidOCR 引擎懒加载单例（与 ../AntiVideo/backend/app/ocr.py 相同配置）"""
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr import RapidOCR
        _ocr_engine = RapidOCR()
    return _ocr_engine


class VideoSummaryRequest(BaseModel):
    url: str
    use_asr: bool = True


def _cfg(msg):
    """AI 配置类错误（前端弹窗引导去 AI 设置）"""
    return HTTPException(status_code=400, detail={"code": "ai_config", "message": msg})


# ============================================
# 工具模型解析（识图 / 语音 / 主模型）
# ============================================

def _resolve_tool_model(db: Session, user_id: int, kind: str):
    """kind: 'speech' | 'vision'。已完整配置返回 (provider, 明文key, model, base_url)，未配置返回 None"""
    s = db.query(AiSetting).filter(AiSetting.user_id == user_id).first()
    key_id = getattr(s, f"{kind}_key_id") if s else None
    model = (getattr(s, f"{kind}_model") or "").strip() if s else ""
    if not key_id and not model:
        return None
    if not model:
        raise _cfg("语音/识图模型未选择完整，请到「我的 → AI 设置」补全后重试")
    if not key_id:
        raise _cfg("语音/识图模型未绑定 API Key，请到「我的 → AI 设置」补全后重试")
    key = db.query(AiKey).filter(AiKey.id == key_id, AiKey.user_id == user_id).first()
    if not key or not key.api_key_enc:
        raise _cfg("语音/识图模型绑定的 API Key 不存在或无密钥，请到 AI 设置重新配置")
    return key.provider, aisettings.decrypt_secret(key.api_key_enc), model, key.custom_base_url


def _resolve_main_model(db: Session, user_id: int):
    """主总结模型：AI 设置当前 Key + 当前模型"""
    s = db.query(AiSetting).filter(AiSetting.user_id == user_id).first()
    key_id = s.key_id if s else None
    model = (s.model or "").strip() if s else ""
    if not key_id or not model:
        raise _cfg("尚未在 AI 设置中选择当前使用的 Key 与模型")
    key = db.query(AiKey).filter(AiKey.id == key_id, AiKey.user_id == user_id).first()
    if not key or not key.api_key_enc:
        raise _cfg("当前选中的 API Key 不存在或无密钥，请到 AI 设置重新配置")
    return key.provider, aisettings.decrypt_secret(key.api_key_enc), model, key.custom_base_url


# ============================================
# 视频下载与 ffmpeg 加工（全部隐藏窗口）
# ============================================

def _download_lowres_video(url: str, tmp: str, on_percent=None) -> str:
    """下载最低可用画质视频（音画俱全），返回文件路径；on_percent 接收 0~1"""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "format": "b[height<=360]/bv*[height<=360]+ba/b",
        "outtmpl": tmp + "/video.%(ext)s",
        "http_headers": {"User-Agent": _BROWSER_UA},
    }
    import os as _os
    bili_cookie = _os.getenv("BILIBILI_COOKIE")
    if bili_cookie:
        opts["cookiejar"] = video_tools._build_cookiejar(bili_cookie)
    if on_percent:
        def _hook(d):
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if d.get("status") == "downloading" and total:
                on_percent(min(1.0, d.get("downloaded_bytes", 0) / total))
        opts["progress_hooks"] = [_hook]
    from yt_dlp import YoutubeDL
    with YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)
    import glob as _glob
    files = _glob.glob(tmp + "/video.*")
    if not files:
        raise HTTPException(status_code=500, detail="视频下载失败")
    return files[0]


def _run_ffmpeg(args):
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args,
                           capture_output=True, timeout=600,
                           creationflags=_CREATE_NO_WINDOW)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.decode("utf-8", errors="replace")[-300:])
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="服务器缺少 ffmpeg，无法处理视频")


def _split_audio(video_path: str, tmp: str):
    """音频转 16k 单声道 mp3 并按 _ASR_CHUNK_SECONDS 分片，返回分片路径列表"""
    _run_ffmpeg([
        "-i", video_path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
        "-f", "segment", "-segment_time", str(_ASR_CHUNK_SECONDS),
        tmp + "/chunk_%03d.mp3",
    ])
    import glob as _glob
    return sorted(_glob.glob(tmp + "/chunk_*.mp3"))


def _extract_frames(video_path: str, tmp: str, duration):
    """均匀抽帧（OCR 用，最多 _OCR_MAX_FRAMES 张），返回 [(秒, jpg路径)]"""
    if not duration:
        return []
    n = min(_OCR_MAX_FRAMES, max(3, int(duration / 10)))
    step = duration / n
    frames = []
    for i in range(n):
        t = round(step * i + step / 2, 1)
        out = f"{tmp}/frame_{i:03d}.jpg"
        _run_ffmpeg(["-ss", str(t), "-i", video_path, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "5", out])
        frames.append((t, out))
    return frames


def _is_similar(a: str, b: str, threshold: float = 0.9) -> bool:
    """连续帧文本相似去重（与 AntiVideo ocr.py 同阈值）"""
    if a == b:
        return True
    if not a or not b:
        return False
    return SequenceMatcher(None, a, b).ratio() > threshold


def _ocr_frames(frames, on_progress=None):
    """逐帧本地 RapidOCR，按时间戳去重合并，返回 [(秒, 文本), ...]"""
    results = []
    prev = ""
    total = len(frames)
    for i, (sec, path) in enumerate(frames):
        try:
            result = _get_ocr_engine()(path)
        except Exception:
            result = None
        text = "\n".join(t.strip() for t in (getattr(result, "txts", None) or []) if t and t.strip())
        if text and not _is_similar(text, prev):
            results.append((sec, text))
            prev = text
        if on_progress:
            on_progress(i + 1, total)
    return results


# ============================================
# 语音转写（OpenAI 兼容 /audio/transcriptions）
# ============================================

def _multipart_body(fields: dict, file_field: str, filename: str, data: bytes):
    boundary = "----anticraft" + secrets.token_hex(8)
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
        f'Content-Type: audio/mpeg\r\n\r\n'.encode() + data + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"\r\n".join(parts), boundary


def transcribe_file(provider, api_key, model, base_url, file_path):
    """转写单个音频分片。按提供商 asr_mode 分支：
    - 默认 OpenAI 兼容 multipart /audio/transcriptions（verbose_json 取分段时间戳）
    - 'chat_audio'：/chat/completions + input_audio 内容块（小米 MiMo ASR 协议）"""
    p = aisettings.get_provider(provider)
    base = (base_url or (p["base_url"] if p else "") or "")
    # 兜底：custom 提供商指向小米 MiMo 时也走 chat_audio 协议
    if p and p.get("asr_mode") == "chat_audio" or "xiaomimimo" in base:
        return _transcribe_chat_audio(provider, api_key, model, base_url, file_path)
    return _transcribe_openai_api(provider, api_key, model, base_url, file_path)


def _transcribe_openai_api(provider, api_key, model, base_url, file_path):
    p = aisettings.get_provider(provider)
    url = ((base_url or (p["base_url"] if p else "")) or "").rstrip("/") + "/audio/transcriptions"
    if provider == "anthropic":
        raise _cfg("该提供商不支持语音转写接口，请为语音模型选择 OpenAI 兼容的提供商")

    with open(file_path, "rb") as f:
        audio_bytes = f.read()

    def _call(fmt):
        body, boundary = _multipart_body(
            {"model": model, "response_format": fmt}, "file", file_path.replace("\\", "/").split("/")[-1], audio_bytes
        )
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": _BROWSER_UA,
        })
        with urllib.request.urlopen(req, timeout=_AI_TIMEOUT) as resp:
            return json.loads(resp.read().decode())

    try:
        data = _call("verbose_json")
    except urllib.error.HTTPError:
        data = _call("json")

    segments = data.get("segments")
    if segments:
        return [(float(s.get("start", 0)), (s.get("text") or "").strip()) for s in segments if s.get("text")]
    return [(0, (data.get("text") or "").strip())] if data.get("text") else []


def _transcribe_chat_audio(provider, api_key, model, base_url, file_path):
    """小米 MiMo ASR：POST /chat/completions，messages 内容为单个 input_audio 块（base64）。
    返回标准 chat 响应，文本在 choices[0].message.content。"""
    import base64 as _b64
    p = aisettings.get_provider(provider)
    base = (base_url or (p["base_url"] if p else "") or "").rstrip("/")
    url = base + "/chat/completions"

    with open(file_path, "rb") as f:
        audio_bytes = f.read()
    ext = (file_path.split(".")[-1] or "mp3").lower()
    fmt = ext if ext in ("mp3", "wav", "m4a", "ogg", "flac", "aac", "webm") else "mp3"
    b64 = _b64.b64encode(audio_bytes).decode()

    payload = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [{
                "type": "input_audio",
                "input_audio": {"data": f"data:audio/{fmt};base64,{b64}", "format": fmt},
            }],
        }],
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers=aisettings._build_headers("openai", api_key), method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_AI_TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = ""
        msg = {401: "语音模型的 API Key 无效或未授权", 403: "无权访问该语音模型",
               404: "语音模型或接口不存在，请到 AI 设置检查"}.get(e.code)
        if msg:
            raise _cfg(msg)
        raise HTTPException(status_code=502, detail=f"语音模型返回 HTTP {e.code}: {detail}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"连接语音模型失败：{e}")

    text = (((data.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
    text = text.strip()
    return [(0, text)] if text else []


def _fmt_ts(sec: float) -> str:
    s = int(sec)
    return f"{s // 60:02d}:{s % 60:02d}"


def _asr_transcript(chunks, provider, api_key, model, base_url, on_chunk=None):
    """顺序转写全部分片并叠加时间偏移，产出 [mm:ss] 行文本"""
    lines = []
    offset = 0.0
    total = max(1, len(chunks))
    for i, path in enumerate(chunks):
        for rel_start, text in transcribe_file(provider, api_key, model, base_url, path):
            if text:
                lines.append(f"[{_fmt_ts(offset + rel_start)}] {text}")
        offset += _ASR_CHUNK_SECONDS
        if on_chunk:
            on_chunk(i + 1, total)
    return "\n".join(lines)


# ============================================
# 主总结模型调用
# ============================================

def _chat_stream_once(provider_id, api_key, model, base_url, system, user_text):
    """流式对话：逐段 yield 文本增量（生成器）。支持 openai/anthropic/responses 三种协议。
    若流式解析失败则回退一次非流式 _chat_once。"""
    p = aisettings.get_provider(provider_id)
    api = aisettings.resolve_api(provider_id, model)
    base = base_url or (p["base_url"] if p else "")
    url = aisettings._endpoint_url(api, base, provider_id)

    if api == "anthropic":
        payload = {"model": model, "max_tokens": 8192, "system": system, "stream": True,
                   "messages": [{"role": "user", "content": user_text}]}
    elif api == "responses":
        payload = {"model": model, "input": system + "\n\n" + user_text,
                   "max_output_tokens": 8192, "stream": True}
    else:
        payload = {"model": model,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_text}],
                   "max_tokens": 8192, "stream": True}

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers=aisettings._build_headers(api, api_key), method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=_AI_TIMEOUT)

    full = []
    streamed_ok = False
    try:
        for raw_line in resp:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if line.startswith("data:"):
                data = line[5:].strip()
                if data == "[DONE]":
                    streamed_ok = True
                    break
                try:
                    ev = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = None
                if api == "anthropic":
                    if ev.get("type") == "content_block_delta":
                        delta = ((ev.get("delta") or {}).get("text")) or None
                    if ev.get("type") == "message_stop":
                        streamed_ok = True
                elif api == "responses":
                    if ev.get("type") == "response.output_text.delta":
                        delta = ev.get("delta") or None
                else:
                    ch = (((ev.get("choices") or [{}])[0]).get("delta") or {}).get("content")
                    delta = ch if isinstance(ch, str) else None
                if delta:
                    full.append(delta)
                    yield delta
            else:
                # 非 data: 前缀（某些网关流式时也整包返回 JSON）——尝试解析一次
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if api == "anthropic":
                    for c in ev.get("content") or []:
                        if c.get("type") == "text" and c.get("text"):
                            t = c["text"]
                            if t:
                                full.append(t)
                                yield t
                    streamed_ok = True
                else:
                    ch = (((ev.get("choices") or [{}])[0]).get("message") or {}).get("content")
                    if isinstance(ch, str) and ch:
                        full.append(ch)
                        yield ch
                    streamed_ok = True
                break
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = ""
        msg = {401: "API Key 无效或未授权", 403: "无权访问该模型，请到 AI 设置更换模型",
               404: "接口或模型不存在（检查 Base URL / 模型 ID），请到 AI 设置调整"}.get(e.code)
        if msg:
            raise _cfg(msg)
        raise HTTPException(status_code=502, detail=f"AI 提供商返回 HTTP {e.code}: {detail}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"连接 AI 提供商失败：{e}")

    # 流式没产出内容 → 回退非流式
    if not streamed_ok or not "".join(full).strip():
        fallback = _chat_once(provider_id, api_key, model, base_url, system, user_text)
        if fallback:
            yield fallback


# ============================================
# Unicode → LaTeX 公式兜底转换（模型不听话时保证公式仍是规范 LaTeX）
# ============================================

# 有序替换（长 token 优先）：把 Unicode/伪 LaTeX 片段转成规范 LaTeX
_FRAG_REPLACEMENTS = [
    ('log₂', r'\log_2'), ('log₃', r'\log_3'), ('log10', r'\log_{10}'), ('log₁₀', r'\log_{10}'),
    ('log', r'\log'), ('ln', r'\ln'), ('lg', r'\lg'),
    ('∑', r'\sum '), ('∫', r'\int '), ('√', r'\sqrt '), ('Δ', r'\Delta '),
    ('·', r'\cdot '), ('×', r'\times '), ('÷', r'\div '),
    ('≈', r'\approx '), ('≠', r'\ne '), ('≤', r'\le '), ('≥', r'\ge '),
    ('±', r'\pm '), ('−', '-'), ('–', '-'), ('—', '-'),
    ('‖', r'\|'), ('→', r'\rightarrow '), ('∈', r'\in '), ('∞', r'\infty '),
    ('π', r'\pi '), ('∝', r'\propto '), ('∅', r'\emptyset '),
    ('₀', r'_0'), ('₁', r'_1'), ('₂', r'_2'), ('₃', r'_3'), ('₄', r'_4'),
    ('₅', r'_5'), ('₆', r'_6'), ('₇', r'_7'), ('₈', r'_8'), ('₉', r'_9'),
    ('⁰', r'^0'), ('¹', r'^1'), ('²', r'^2'), ('³', r'^3'), ('⁴', r'^4'),
    ('⁵', r'^5'), ('⁶', r'^6'), ('⁷', r'^7'), ('⁸', r'^8'), ('⁹', r'^9'),
]


def _frag_to_latex(s: str) -> str:
    out = s
    for src, dst in _FRAG_REPLACEMENTS:
        if src in ('log', 'ln', 'lg'):
            # 防递归：跳过已被前序替换转出的 \log / \ln / \lg（函数式替换不解析转义）
            out = re.sub(r'(?<!\\)' + src, lambda m: dst, out)
        else:
            out = out.replace(src, dst)
    return out


# 疑似行内公式片段（局部匹配，保守避免误伤普通文字）：
_MATH_TAIL = r'[−\-\u2212∑0-9A-Za-z_/\.·×≈π()‖₂₃₁₀₄₅⁰¹²³⁴⁵\s]'
_INLINE_FORMULA_RE = re.compile(
    # 1) H(p,q) = ... 一类等式（含带下标的标识符如 D_KL；等号后只收数学字符）
    r'[A-Za-z_]{1,8}(?:₂|₃|₁|₀)?\([^)\n]{1,60}\)\s*=\s*' + _MATH_TAIL + r'{2,70}'
    # 2) -∑p·log₂p 一类求和式
    r'|[−\-\u2212]?∑' + _MATH_TAIL + r'{1,70}'
    # 3) -log₂(128)=7 一类对数
    r'|[−\-\u2212]?(?:log|ln|lg)₂?\([^)\n]{1,50}\)(?:\s*=\s*[0-9.]+)?'
    # 3b) log₂n / -log₂p 无括号形态
    r'|[−\-\u2212]?(?:log|ln|lg)₂?[0-9A-Za-z]+'
    # 4) 4.7 ≈ 4.7 一类近似
    r'|\d+(?:\.\d+)?\s*≈\s*\d+(?:\.\d+)?'
    # 4b) 熵 ≈ 4.14（仅数字侧）
    r'|≈\s*\d+(?:\.\d+)?'
    # 5) 概率式 p(x) = 1/N
    r'|[A-Za-z]{1,3}\((?:p|q|x|y|k)\)(?:\s*=\s*[0-9/.\-+∑]{1,20})?',
)


def _latexize(md: str) -> str:
    """把 AI 输出里未用 LaTeX 包裹的 Unicode 公式，确定性转换成 $...$ 规范公式。"""
    if not md:
        return md
    holders = {}

    def _hold(m):
        k = f"\u0000LATEXKEEP{len(holders)}\u0000"
        holders[k] = m.group(0)
        return k

    # 保护：代码块 / 行内代码 不动
    text = re.sub(r'```[\s\S]*?```', _hold, md)
    text = re.sub(r'`[^`\n]+`', _hold, text)

    # ── 数学规范化（作用于非代码全文，含已包裹的 $..$）──
    # a) ASCII log2/log10/log3 → \log_2 / \log_{10} / \log_3（含已有 \log2 形态；先裸 log，后 \log）
    text = re.sub(r'(?<![A-Za-z\\])log([0-9]+)', lambda m: '\\log_{' + m.group(1) + '}', text)
    text = re.sub(r'\\log([0-9]+)', lambda m: '\\log_{' + m.group(1) + '}', text)
    # b) 修复美元符错位闭合：-$\log_2 $p(x) → $-\log_2 p(x)$（尾部是 p(x) 式函数调用）
    text = re.sub(
        r'-(\$[^$\n]+?)\$(\s*[a-z]+(?:\([a-z]+\))?)(?!\$)',
        lambda m: '$-' + m.group(1)[1:-1] + m.group(2) + '$', text,
    )

    # 保护：已包裹的 $..$ $$..$$ 数学（内容不以空格结尾，避免拆开 `$x$ 文本`）
    text = re.sub(r'\$\$[\s\S]+?\$\$', _hold, text)
    text = re.sub(r'(?<!\\)\$[^\n$]+?(?<!\s)\$(?!\$)', _hold, text)

    def _wrap(m):
        frag = m.group(0).strip()
        return '$' + _frag_to_latex(frag) + '$'

    text = _INLINE_FORMULA_RE.sub(_wrap, text)

    for k, v in holders.items():
        text = text.replace(k, v)
    return text


_POLISH_PROMPT = (
    "你是 Markdown 排版审查员。用户会给你一段 AI 生成的视频总结（Markdown），你的任务：只修正排版问题，"
    "不改动内容实质。\n"
    "要求：\n"
    "1. 所有数学公式改为规范 LaTeX：行内用 `$...$`、独立块用 `$$...$$`；`\\sum`、`\\log_2`、`\\frac`、`\\approx` 等命令正确，"
    "下标/上标规范，禁止用 Unicode 符号（∑、log₂、≈、·）直接表达数学；\n"
    "2. 检查标题层级（## 顺序无跳级）、列表、表格、代码块、引用块结构完整闭合；\n"
    "3. 删除多余空行与残留乱码；\n"
    "4. 直接输出修正后的完整 Markdown 正文，不要任何解释、不要用代码块包裹整份输出。"
)


def _chat_once(provider_id, api_key, model, base_url, system, user_text):
    p = aisettings.get_provider(provider_id)
    api = aisettings.resolve_api(provider_id, model)
    base = base_url or (p["base_url"] if p else "")
    url = aisettings._endpoint_url(api, base, provider_id)

    if api == "anthropic":
        payload = {"model": model, "max_tokens": 8192, "system": system,
                   "messages": [{"role": "user", "content": user_text}]}
    elif api == "responses":
        payload = {"model": model, "input": system + "\n\n" + user_text, "max_output_tokens": 8192}
    else:
        payload = {"model": model,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_text}],
                   "max_tokens": 8192, "stream": False}

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers=aisettings._build_headers(api, api_key), method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=_AI_TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = ""
        msg = {401: "API Key 无效或未授权", 403: "无权访问该模型，请到 AI 设置更换模型",
               404: "接口或模型不存在（检查 Base URL / 模型 ID），请到 AI 设置调整"}.get(e.code)
        if msg:
            raise _cfg(msg)
        raise HTTPException(status_code=502, detail=f"AI 提供商返回 HTTP {e.code}: {detail}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"连接 AI 提供商失败：{e}")

    if api == "responses":
        if data.get("output_text"):
            return data["output_text"]
        for item in data.get("output") or []:
            for c in item.get("content") or []:
                if c.get("type") in ("output_text", "text") and c.get("text"):
                    return c["text"]
        raise HTTPException(status_code=502, detail="AI 响应中没有文本输出")
    if api == "anthropic":
        for c in data.get("content") or []:
            if c.get("type") == "text" and c.get("text"):
                return c["text"]
        raise HTTPException(status_code=502, detail="AI 响应中没有文本输出")
    choices = data.get("choices") or []
    if choices and ((choices[0].get("message") or {}).get("content")):
        return choices[0]["message"]["content"]
    raise HTTPException(status_code=502, detail="AI 响应中没有文本输出")


_SYSTEM_PROMPT = (
    "你是专业的技术视频深度解析助手。根据给定的视频素材（音频转录、画面文字、字幕或简介），"
    "用简体中文输出一份详实的 Markdown 解析报告。\n"
    "【公式铁律（最高优先级，违反即不合格）】\n"
    "所有数学公式必须用 LaTeX 并用美元符包裹：行内公式 `$...$`（如 `$H=-\\sum_x p(x)\\log_2 p(x)$`），"
    "独立公式块用 `$$...$$`。下标用 `_`（如 `\\log_2 26`）、上标用 `^`、求和用 `\\sum`、分式用 `\\frac{a}{b}`、"
    "近似用 `\\approx`、乘号用 `\\cdot`。\n"
    "绝对禁止用 Unicode 符号拼公式（如 `∑`、`log₂`、`≈`、`·` 直接出现在正文里表达数学关系），"
    "也不要把公式写成 `-sum p log p` 这类伪 LaTeX。\n"
    "错误示例：`熵 = −∑p·log p`；正确示例：`熵 $H=-\\sum_x p(x)\\log_2 p(x)$`。\n"
    "【写作铁律】\n"
    "1. 直接输出 Markdown 正文，不要把整份内容包进代码块；\n"
    "2. 直陈观点，禁止「视频里说」「作者认为」「他指出」这类转述铺垫；\n"
    "3. 每条要点至少 2~3 句：先给结论/原理，再讲清机制/证据/举例，最后点出含义或适用边界；"
    "单句要点太薄时宁可合并，不可空泛；\n"
    "4. 对视频中讲到的原理与现象要做详细展开：交代背景、内在机制、因果链条、相关术语的解释、"
    "与直觉的差异（哪里反直觉），切中要点、有的放矢，不要复述概括成空话；\n"
    "5. 只基于素材内容，不编造事实与数字；某节没有可靠内容就省略该节。\n"
    "【报告结构】（按序输出，无内容则省略该节）\n"
    "## 一句话总览\n"
    "## 总体摘要（200~400 字：覆盖全部重要概念，去铺垫句、密度要高）\n"
    "## 核心原理剖析（逐条展开视频讲解的关键原理：是什么、为什么成立、如何运作、反直觉点、实际影响）\n"
    "## 关键现象与细节（视频中展示的现象、实验、例子：现象描述 → 背后的机制 → 说明了什么）\n"
    "## 内容时间线（按 [mm:ss] 标注，每节 `- mm:ss 章节名：一句话说明`；无可靠时间戳则省略）\n"
    "## 金句摘录（每条不超过 40 字）\n"
    "## 结语与延伸（对内容的一句话评价 + 适合深入的方向/资料）\n"
)


# ============================================
# 字幕提取（下载失败时的降级路径）
# ============================================

def _summary_ydl_opts():
    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 20,
        "skip_download": True, "writesubtitles": True, "writeautomaticsub": True,
        "subtitleslangs": _SUB_LANGS, "subtitlesformat": "json3/vtt/srt/best",
        "http_headers": {"User-Agent": _BROWSER_UA},
    }
    import os as _os
    if _os.getenv("BILIBILI_COOKIE"):
        opts["cookiejar"] = video_tools._build_cookiejar(_os.getenv("BILIBILI_COOKIE"))
    return opts


def _pick_subtitle(info: dict):
    """语言按 _SUB_LANGS 优先（中文优先），同语言手写字幕优先于自动字幕。返回 (来源标记, url) 或 None"""
    tracks_pair = (("subtitles", info.get("subtitles") or {}), ("automatic_captions", info.get("automatic_captions") or {}))
    ordered_langs = _SUB_LANGS + [k for k in (info.get("subtitles") or {}) if k not in _SUB_LANGS] \
        + [k for k in (info.get("automatic_captions") or {}) if k not in _SUB_LANGS]
    for lang in ordered_langs:
        for source, tracks in tracks_pair:
            entries = tracks.get(lang)
            if not entries:
                continue
            for fmt in ("json3", "vtt", "srt"):
                for e in entries:
                    if e.get("ext") == fmt and e.get("url"):
                        return f"{source}:{lang}", e["url"]
    return None


def _fmt_ts_ms(ms):
    s = int((ms or 0) / 1000)
    return f"{s // 60:02d}:{s % 60:02d}"


def _clean_text(t: str) -> str:
    t = re.sub(r"<[^>]+>", "", t or "")
    return t.replace("\\n", " ").replace("\n", " ").strip()


def _parse_json3(raw: bytes) -> str:
    data = json.loads(raw.decode("utf-8", errors="replace"))
    lines = []
    for ev in data.get("events") or []:
        segs = ev.get("segs") or []
        text = _clean_text("".join(s.get("utf8", "") for s in segs))
        if text and text != "\n":
            lines.append(f"[{_fmt_ts_ms(ev.get('tStartMs'))}] {text}")
    return "\n".join(lines)


def _parse_vtt_srt(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    lines_out = []
    for block in re.split(r"\n\s*\n", text):
        if not block.strip() or block.strip().startswith(("WEBVTT", "NOTE")):
            continue
        ts = re.search(r"(\d{1,2}):(\d{2}):(\d{2})[.,]\d+\s*-->", block) or re.search(r"(\d{1,2}):(\d{2}):(\d{2})[.,]\d+", block)
        body = _clean_text(
            "\n".join(
                ln for ln in block.splitlines()
                if "-->" not in ln and not re.fullmatch(r"\d+\s*", ln or "") and ln.strip()
            )
        )
        if not body:
            continue
        if ts:
            mm, ss = int(ts.group(2)) + int(ts.group(1)) * 60, int(ts.group(3))
            lines_out.append(f"[{mm:02d}:{ss:02d}] {body}")
        else:
            lines_out.append(body)
    return "\n".join(lines_out)


def fetch_transcript(url: str, ext: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": _BROWSER_UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    if ext == "json3":
        return _parse_json3(raw)
    return _parse_vtt_srt(raw)


def _truncate(text: str):
    if len(text) <= _MAX_TRANSCRIPT_CHARS:
        return text, False
    head = int(_MAX_TRANSCRIPT_CHARS * 0.8)
    tail = _MAX_TRANSCRIPT_CHARS - head
    return text[:head] + "\n……[中段过长已截断]……\n" + text[-tail:], True


def _view_via_api(url: str):
    m = re.search(r"BV[0-9A-Za-z]+", url)
    if not m:
        return None
    req = urllib.request.Request(
        f"https://api.bilibili.com/x/web-interface/view?bvid={m.group(0)}",
        headers={"User-Agent": _BROWSER_UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read().decode())
        if d.get("code") == 0 and d.get("data"):
            return d["data"]
    except Exception:
        return None
    return None


def _fallback_material(info, title, uploader, duration, url):
    """字幕 → 简介 降级，返回 (user_text, transcript_text, source)"""
    track = _pick_subtitle(info)
    if track:
        source_tag, sub_url = track
        ext = sub_url.split(".")[-1].split("?")[0]
        transcript = fetch_transcript(sub_url, ext if ext in ("json3", "vtt", "srt") else "vtt")
        source = "subtitle" if source_tag.startswith("subtitles:") else "auto_subtitle"
    else:
        transcript = _clean_text(info.get("description") or "")[:3000]
        source = "metadata"
    if len(transcript.strip()) < 30:
        raise HTTPException(status_code=422, detail="未能从视频中提取到有效内容（无音频转录、画面无文字、也无字幕/简介），无法生成总结")
    user_text = f"视频标题：{title}\nUP 主/作者：{uploader}\n" + \
        (f"时长：{int(duration) // 60} 分 {int(duration) % 60} 秒\n\n" if duration else "") + \
        "以下是视频转录文本：\n\n" + transcript
    return user_text, transcript, source


# ============================================
# 后台任务：状态表 + 线程执行体
# ============================================

_sum_lock = threading.Lock()
_sum_tasks = {}  # task_id -> {status, stage, percent, error, result}


def _set_task(task_id, **kw):
    with _sum_lock:
        _sum_tasks[task_id].update(kw)


def _run_summary_job(task_id, url, use_asr, main_cfg, speech_cfg, user_id):
    import tempfile
    tmp = tempfile.mkdtemp(prefix="anticraft_vsum_")
    video_path = None
    title = None
    try:
        # ── 1) 元信息 ──
        _set_task(task_id, stage="解析视频", percent=4)
        video_tools._patch_bilibili_headers()
        try:
            from yt_dlp import YoutubeDL
            with YoutubeDL({**_summary_ydl_opts()}) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception:
            vd = _view_via_api(url)
            if not vd:
                raise HTTPException(status_code=400, detail="视频解析失败：无法从该链接获取视频信息")
            owner = vd.get("owner") or {}
            info = {"title": vd.get("title"), "uploader": owner.get("name"), "duration": vd.get("duration"),
                    "description": vd.get("desc") or "", "webpage_url": url,
                    "subtitles": {}, "automatic_captions": {}}

        title = info.get("title") or "未知标题"
        uploader = video_tools._resolve_uploader(url, info.get("uploader"))
        duration = info.get("duration")
        webpage = info.get("webpage_url") or url

        if duration and duration > _MAX_VIDEO_SECONDS:
            raise HTTPException(status_code=400, detail=f"视频超过 {_MAX_VIDEO_SECONDS // 60} 分钟，暂不支持总结")

        transcript = ""
        visual = ""
        source = ""

        # ── 2) 下载低清视频（8%→45%）──
        _set_task(task_id, stage="下载视频", percent=8)
        try:
            video_path = _download_lowres_video(
                url, tmp,
                on_percent=lambda d: _set_task(task_id, percent=min(44, 8 + int(36 * d))),
            )
        except HTTPException:
            video_path = None
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"视频下载失败：{str(e)[:200]}")

        if video_path:
            # ── 3) 音频转写（45%→74%）；失败降级为仅 OCR，不中断整个任务 ──
            if speech_cfg:
                _set_task(task_id, stage="音频转写", percent=45)
                try:
                    chunks = _split_audio(video_path, tmp)
                    if chunks:
                        transcript = _asr_transcript(
                            chunks, speech_cfg[0], speech_cfg[1], speech_cfg[2], speech_cfg[3],
                            on_chunk=lambda done, total: _set_task(task_id, percent=min(73, 45 + int(28 * done / total))),
                        )
                        source = "asr"
                except Exception as e:
                    _log(f"video-summary ASR failed, degrade to OCR: {str(e)[:150]}")
                    transcript = ""
                    source = ""

            # ── 4) 抽帧 OCR（75%→91%）──
            _set_task(task_id, stage="画面识别", percent=75)
            frames = _extract_frames(video_path, tmp, duration)
            if frames:
                def _ocr_prog(done, total):
                    _set_task(task_id, stage="画面识别", percent=min(90, 75 + int(15 * done / total)))
                ocr_items = _ocr_frames(frames, on_progress=_ocr_prog)
                visual = "\n".join(f"[{_fmt_ts(sec)}] {text}" for sec, text in ocr_items)
                source = (source + "+ocr").lstrip("+")

        if video_path is not None:
            material = ""
            if transcript:
                material += "【音频转录】\n" + transcript + "\n\n"
            if visual:
                material += "【画面文字】\n" + visual + "\n\n"
            if len(material.strip()) < 30:
                # 主管线没提取到内容 → 回退字幕/简介
                user_text, transcript, source = _fallback_material(info, title, uploader, duration, url)
            else:
                user_text = f"视频标题：{title}\nUP 主/作者：{uploader}\n" + \
                    (f"时长：{int(duration) // 60} 分 {int(duration) % 60} 秒\n\n" if duration else "\n") + material
        else:
            # ── 降级路径（下载失败）：字幕 → 简介 ──
            user_text, transcript, source = _fallback_material(info, title, uploader, duration, url)

        transcript_len = len(transcript or "")
        _, truncated = _truncate(transcript) if transcript else ("", False)

        # ── 5) 主模型总结（92%→99%），流式写入 stream_text ──
        _set_task(task_id, stage="AI 总结", percent=93)
        streamed = []
        for chunk in _chat_stream_once(main_cfg[0], main_cfg[1], main_cfg[2], main_cfg[3], _SYSTEM_PROMPT, user_text):
            streamed.append(chunk)
            with _sum_lock:
                _sum_tasks[task_id]["stream_text"] += chunk
        raw_md = "".join(streamed)
        # 公式兜底：把模型漏掉的 Unicode 公式确定性转为 LaTeX（不依赖模型自觉）
        summary_md = _latexize(raw_md)
        with _sum_lock:
            _sum_tasks[task_id]["stream_text"] = summary_md
        _set_task(task_id, percent=99)

        # ── 6) AI 排版校对（二次审查，保证公式/结构正确；失败则沿用当前结果）──
        _set_task(task_id, stage="排版校对", percent=97)
        try:
            polished = _chat_once(main_cfg[0], main_cfg[1], main_cfg[2], main_cfg[3],
                                  _POLISH_PROMPT, summary_md)
            if polished:
                polished = _latexize(polished)
                if len(polished) > 50:
                    summary_md = polished
        except Exception as e:
            _log(f"video-summary polish skipped: {str(e)[:100]}")

        _set_task(task_id, status="done", stage="完成", percent=100, result={
            "summary_md": summary_md,
            "video": {"title": title, "uploader": uploader, "duration": duration, "url": webpage},
            "source": source,
            "transcript_chars": transcript_len,
            "truncated": truncated,
            "model": f"{main_cfg[0]}/{main_cfg[2]}",
        })
        _save_history(user_id, status="done", title=title, uploader=uploader, duration=duration,
                      url=webpage, source=source, model=f"{main_cfg[0]}/{main_cfg[2]}",
                      transcript_chars=transcript_len, truncated=1 if truncated else 0,
                      summary_md=summary_md)
    except HTTPException as e:
        _set_task(task_id, status="failed", stage="失败", error=e.detail)
        detail = e.detail.get("message") if isinstance(e.detail, dict) else e.detail
        _save_history(user_id, status="failed", title=title, error=str(detail)[:500])
    except Exception as e:
        _set_task(task_id, status="failed", stage="失败", error=str(e)[:200])
        _save_history(user_id, status="failed", title=title, error=str(e)[:500])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        # 只保留最近 40 个任务，防内存膨胀
        with _sum_lock:
            while len(_sum_tasks) > 40:
                _sum_tasks.pop(next(iter(_sum_tasks)))


# ============================================
# 路由：启动任务 + 轮询进度
# ============================================

@router.post("/api/tools/video-summary/start", tags=["工具"])
def video_summary_start(req: VideoSummaryRequest, current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    """创建总结任务并立即返回 task_id；前端轮询 /progress 获取阶段与百分比"""
    url = (req.url or "").strip()
    if not re.match(r"^https?://", url):
        raise HTTPException(status_code=400, detail="请输入有效的视频链接")

    main_cfg = _resolve_main_model(db, current_user.id)
    speech_cfg = None
    if req.use_asr:
        speech_cfg = _resolve_tool_model(db, current_user.id, "speech")
        if not speech_cfg:
            raise _cfg("已选择转写音频，但尚未在「我的 → AI 设置」配置语音模型；可取消勾选「转写音频」或先完成配置")

    task_id = secrets.token_urlsafe(12)
    with _sum_lock:
        _sum_tasks[task_id] = {"status": "running", "stage": "准备中", "percent": 1, "error": None, "result": None, "stream_text": ""}
    # 记录 active 任务（退出重进可恢复）
    act = db.query(VideoSummaryActive).filter(VideoSummaryActive.user_id == current_user.id).first()
    if act:
        act.task_id = task_id
    else:
        db.add(VideoSummaryActive(user_id=current_user.id, task_id=task_id))
    db.commit()
    threading.Thread(
        target=_run_summary_job,
        args=(task_id, url, req.use_asr, main_cfg, speech_cfg, current_user.id),
        daemon=True,
    ).start()
    return {"task_id": task_id}


@router.get("/api/tools/video-summary/progress", tags=["工具"])
def video_summary_progress(task_id: str = Query(...), current_user: User = Depends(get_current_user_obj)):
    """轮询总结任务进度；done 时附带完整 result"""
    task = _sum_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    return {
        "status": task["status"],
        "stage": task["stage"],
        "percent": task["percent"],
        "error": task["error"],
        "result": task["result"],
    }


@router.get("/api/tools/video-summary/stream", tags=["工具"])
def video_summary_stream(task_id: str = Query(...), current_user: User = Depends(get_current_user_obj)):
    """SSE 流式输出 AI 总结增量文本（前端在「AI 总结」阶段连接本端点）"""
    task = _sum_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")

    def gen():
        sent = 0
        idle = 0
        while True:
            with _sum_lock:
                st = task.get("stream_text") or ""
                status = task["status"]
            if len(st) > sent:
                yield f"data: {json.dumps({'delta': st[sent:]}, ensure_ascii=False)}\n\n"
                sent = len(st)
                idle = 0
            elif status in ("done", "failed"):
                yield "data: [DONE]\n\n"
                return
            else:
                idle += 1
                if idle > 600:  # 最多等 ~180s（覆盖排版校对阶段）
                    yield "data: [DONE]\n\n"
                    return
                import time as _t
                _t.sleep(0.3)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/api/tools/video-summary/state", tags=["工具"])
def video_summary_state(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    """进入页面时调用：返回进行中的任务快照 + 最近一条已完成结果（退出重进恢复显示）"""
    act = db.query(VideoSummaryActive).filter(VideoSummaryActive.user_id == current_user.id).first()
    active = None
    if act:
        task = _sum_tasks.get(act.task_id)
        if task and task["status"] in ("running", "done"):
            active = {
                "task_id": act.task_id,
                "status": task["status"],
                "stage": task["stage"],
                "percent": task["percent"],
            }
        else:
            db.delete(act)
            db.commit()

    last = (db.query(VideoSummaryRecord)
            .filter(VideoSummaryRecord.user_id == current_user.id, VideoSummaryRecord.status == "done")
            .order_by(VideoSummaryRecord.created_at.desc()).first())
    return {
        "active": active,
        "last_result": _record_to_result(last) if last else None,
    }


def _record_to_result(r):
    if not r:
        return None
    return {
        "summary_md": r.summary_md or "",
        "video": {"title": r.title, "uploader": r.uploader, "duration": r.duration, "url": r.url},
        "source": r.source,
        "transcript_chars": r.transcript_chars or 0,
        "truncated": bool(r.truncated),
        "model": r.model,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/api/tools/video-summary/history", tags=["工具"])
def video_summary_history(current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    """历史记录列表（最新在前，最多 20 条）"""
    rows = (db.query(VideoSummaryRecord)
            .filter(VideoSummaryRecord.user_id == current_user.id)
            .order_by(VideoSummaryRecord.created_at.desc())
            .limit(20).all())
    return {"history": [
        {
            "id": r.id,
            "status": r.status,
            "title": r.title,
            "uploader": r.uploader,
            "duration": r.duration,
            "url": r.url,
            "source": r.source,
            "model": r.model,
            "error": r.error,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]}


@router.get("/api/tools/video-summary/history/{record_id}", tags=["工具"])
def video_summary_history_detail(record_id: int, current_user: User = Depends(get_current_user_obj), db: Session = Depends(get_db)):
    """单条历史详情（含完整 summary_md）"""
    r = (db.query(VideoSummaryRecord)
         .filter(VideoSummaryRecord.id == record_id, VideoSummaryRecord.user_id == current_user.id)
         .first())
    if not r:
        raise HTTPException(status_code=404, detail="记录不存在")
    return _record_to_result(r)
