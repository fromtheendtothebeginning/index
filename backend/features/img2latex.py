# features/img2latex.py — 图文转 LaTeX 工具：AI 识图生成 LaTeX 代码 + 服务器 XeLaTeX 编译出 PDF

import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

import aisettings
from database import get_db
from deps import get_current_user_obj, _log
from models import AiKey, AiSetting, User

router = APIRouter()

_MAX_IMAGES = 5
_MAX_IMAGE_BYTES = 6 * 1024 * 1024   # 单张 ≤6MB
_MAX_MD_FILES = 2                    # Markdown 文件 ≤2 份
_MAX_MD_BYTES = 256 * 1024           # 单份 md ≤256KB
_MAX_MD_CHARS = 50000                # 单份 md 送入 AI 最多 5 万字
_MAX_NOTES_CHARS = 20000             # 文字说明 ≤2 万字
_AI_TIMEOUT = 300                    # 识图生成超时
_COMPILE_TIMEOUT = 90                # 单遍 XeLaTeX 超时
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0

_ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"}


def _cfg(msg):
    """AI 配置类错误（前端弹窗引导去 AI 设置）"""
    return HTTPException(status_code=400, detail={"code": "ai_config", "message": msg})


def _resolve_vision_model(db: Session, user_id: int):
    """识图模型：AI 设置的 vision_key_id + vision_model，返回 (provider, 明文key, model, base_url)"""
    s = db.query(AiSetting).filter(AiSetting.user_id == user_id).first()
    key_id = s.vision_key_id if s else None
    model = (s.vision_model or "").strip() if s else ""
    if not key_id and not model:
        raise _cfg("尚未在 AI 设置中配置识图模型，请到「我的 → AI 设置」完成配置")
    if not model:
        raise _cfg("识图模型未选择完整，请到「我的 → AI 设置」补全后重试")
    if not key_id:
        raise _cfg("识图模型未绑定 API Key，请到「我的 → AI 设置」补全后重试")
    key = db.query(AiKey).filter(AiKey.id == key_id, AiKey.user_id == user_id).first()
    if not key or not key.api_key_enc:
        raise _cfg("识图模型绑定的 API Key 不存在或无密钥，请到 AI 设置重新配置")
    return key.provider, aisettings.decrypt_secret(key.api_key_enc), model, key.custom_base_url


# ============================================
# AI 生成 LaTeX
# ============================================

_SYSTEM_PROMPT = (
    "你是专业的 LaTeX 排版专家。用户会提供图片（题目、笔记、板书、试卷、文档截图等）、文字说明和/或 Markdown 文件内容，"
    "请把内容整理成一份完整、可直接编译的 LaTeX 文档。\n"
    "要求：\n"
    "1. 第一行必须是 \\documentclass，文档类固定用 ctexart（支持中文，XeLaTeX 编译）；最后一行必须是 \\end{document}，结构完整；\n"
    "2. 图片中的文字、数学公式、表格、列表如实还原；Markdown 内容保留其结构（标题→section、列表→itemize/enumerate、表格→tabular、代码→verbatim/listing）；文字说明中的要求尽量满足；\n"
    "3. 公式用标准 LaTeX 数学环境（amsmath）：下标 _ 上标 ^ 分数 \\frac 求和 \\sum 积分 \\int；\n"
    "4. 只使用常见宏包：amsmath、amssymb、geometry、enumitem、booktabs、array、fancyvrb；禁止冷门或过时宏包；\n"
    "5. 禁止 \\includegraphics 等引用外部文件的命令（编译环境无外部文件）；图片内容用文字/表格/公式表达；\n"
    "6. 数学铁律：只有真正的数学公式才用数学环境（$...$、\\(...\\)、\\[\\]）；普通文本（数字、百分比、文件名、代码标识符）一律写成普通文本，不要包数学环境；\n"
    "7. 百分号在 LaTeX 中是注释符，所有需要显示的 % 必须写为 \\%（含数学环境内外）；如 30% 写 30\\%，3/10 写 3/10（不要写成 \\\\(3/10=30\\\\%\\\\) 这种用数学环境包普通文本的写法）；\n"
    "8. 只输出 LaTeX 源代码本身：不要 markdown 代码块围栏（```），不要任何解释或多余文字。"
)


def _strip_fence(text: str) -> str:
    """去掉模型可能包裹的 markdown 代码围栏"""
    m = re.search(r"```(?:latex|tex)?\s*\n(.*?)\n?\s*```", text, re.S)
    return (m.group(1) if m else text).strip() + "\n"


def _ai_vision_chat(provider_id, api_key, model, base_url, system, user_text, images):
    """带图对话：images = [(mime, b64)]，user_text 为已组装好的文字/Markdown 说明。按 provider api 风格构造，返回文本。"""
    p = aisettings.get_provider(provider_id)
    api = aisettings.resolve_api(provider_id, model)
    base = base_url or (p["base_url"] if p else "")
    url = aisettings._endpoint_url(api, base, provider_id)

    user_text = user_text or "请根据输入内容生成 LaTeX 文档。"

    if api == "anthropic":
        parts = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
                 for mime, b64 in images]
        parts.append({"type": "text", "text": user_text})
        payload = {"model": model, "max_tokens": 8192, "system": system,
                   "messages": [{"role": "user", "content": parts}]}
    elif api == "responses":
        parts = [{"type": "input_text", "text": user_text}]
        parts += [{"type": "input_image", "image_url": f"data:{mime};base64,{b64}"} for mime, b64 in images]
        payload = {"model": model, "instructions": system, "max_output_tokens": 8192,
                   "input": [{"role": "user", "content": parts}]}
    else:
        parts = [{"type": "text", "text": user_text}]
        parts += [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}} for mime, b64 in images]
        payload = {"model": model,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": parts}],
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
               404: "接口或模型不存在（检查 Base URL / 模型 ID），请到 AI 设置调整",
               413: "图片总大小超出模型限制，请减少图片数量或压缩后重试"}.get(e.code)
        if msg:
            raise _cfg(msg)
        raise HTTPException(status_code=502, detail=f"AI 提供商返回 HTTP {e.code}: {detail}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"连接 AI 提供商失败：{e}")

    if api == "responses":
        if data.get("output_text"):
            return data["output_text"]
        for item in data.get("output") or []:
            for c in item.get("content") or []:
                if c.get("type") in ("output_text", "text") and c.get("text"):
                    return c["text"]
    elif api == "anthropic":
        for c in data.get("content") or []:
            if c.get("type") == "text" and c.get("text"):
                return c["text"]
    else:
        choices = data.get("choices") or []
        content = (choices[0].get("message") or {}).get("content") if choices else None
        if isinstance(content, list):   # 部分网关把 content 返回为数组
            content = "".join(c.get("text") or "" for c in content if isinstance(c, dict))
        if content:
            return content
    raise HTTPException(status_code=502, detail="AI 响应中没有文本输出")


@router.post("/api/tools/img2latex/generate", tags=["工具"])
def img2latex_generate(
    images: Optional[list[UploadFile]] = File(default=None),
    md_files: Optional[list[UploadFile]] = File(default=None),
    notes: str = Form(""),
    current_user: User = Depends(get_current_user_obj),
    db: Session = Depends(get_db),
):
    """图片/Markdown 文件/文字说明（任一或任意组合）→ AI 生成 LaTeX 代码（需在 AI 设置配置识图模型）"""
    images = images or []
    md_files = md_files or []
    notes = (notes or "").strip()
    if len(images) > _MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"最多上传 {_MAX_IMAGES} 张图片")
    if len(md_files) > _MAX_MD_FILES:
        raise HTTPException(status_code=400, detail=f"最多上传 {_MAX_MD_FILES} 份 Markdown 文件")
    if len(notes) > _MAX_NOTES_CHARS:
        raise HTTPException(status_code=400, detail=f"文字说明不能超过 {_MAX_NOTES_CHARS} 字")
    if not images and not md_files and not notes:
        raise HTTPException(status_code=400, detail="请至少提供图片、Markdown 文件或文字说明中的一种")

    parsed = []
    for f in images:
        raw = f.file.read()
        if len(raw) > _MAX_IMAGE_BYTES:
            raise HTTPException(status_code=400, detail=f"图片「{f.filename}」超过 6MB，请压缩后重试")
        mime = (f.content_type or "").lower().split(";")[0]
        if mime not in _ALLOWED_MIME:
            raise HTTPException(status_code=400, detail=f"不支持的图片格式「{mime}」，请用 png/jpg/webp/gif/bmp")
        import base64 as _b64
        parsed.append((mime, _b64.b64encode(raw).decode()))

    md_texts = []
    for f in md_files:
        raw = f.file.read()
        if len(raw) > _MAX_MD_BYTES:
            raise HTTPException(status_code=400, detail=f"Markdown 文件「{f.filename}」超过 256KB，请精简后重试")
        md_texts.append(raw.decode("utf-8", errors="replace")[:_MAX_MD_CHARS])

    user_text = "请根据以下输入内容生成 LaTeX 文档。"
    if md_texts:
        for i, mt in enumerate(md_texts, 1):
            user_text += f"\n\n【Markdown 文件 {i}】\n{mt}"
    if notes:
        user_text += f"\n\n【文字说明】\n{notes}"

    provider_id, api_key, model, base_url = _resolve_vision_model(db, current_user.id)
    _log(f"img2latex generate: user={current_user.id} model={provider_id}/{model} "
         f"images={len(parsed)} md={len(md_texts)} notes={len(notes)}")
    code = _ai_vision_chat(provider_id, api_key, model, base_url, _SYSTEM_PROMPT, user_text, parsed)
    return {"code": _strip_fence(code)}


# ============================================
# XeLaTeX 编译
# ============================================

class CompileRequest(BaseModel):
    code: str


def _fix_math_percent(code: str) -> str:
    """数学环境内裸 % 转义为转义百分号：% 是 LaTeX 注释符，若 AI 把含 % 的文本包进数学环境，
    会导致 % 吞掉闭合分隔符（如 \\(3/10 = 30%\\)）使文档编译失败。"""
    def _esc(m):
        return re.sub(r"(?<!\\)%", r"\\%", m.group(0))
    return re.sub(r"(\\\[.*?\\\]|\\\(.*?\\\)|\$\$.*?\$\$|\$[^$\n]*\$)", _esc, code, flags=re.S)


def _sanitize_latex(code: str) -> str:
    """编译前防御性清洗：去首尾空白 + 修复数学环境内 % + 补齐缺失的文档头"""
    code = code.strip()
    if not code.startswith("\\documentclass"):
        code = "\\documentclass{ctexart}\n" + code
    code = _fix_math_percent(code)
    return code + "\n"


@router.get("/api/tools/img2latex/available", tags=["工具"])
def img2latex_available(_user: User = Depends(get_current_user_obj)):
    """编译引擎可用性（xelatex 是否安装）"""
    return {"engine": shutil.which("xelatex") is not None}


def _run_xelatex(tmp: str, name: str) -> None:
    cmd = ["xelatex", "-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape",
           f"-output-directory={tmp}", f"{name}.tex"]
    r = subprocess.run(cmd, cwd=tmp, capture_output=True, timeout=_COMPILE_TIMEOUT,
                       creationflags=_CREATE_NO_WINDOW)
    if not os.path.exists(os.path.join(tmp, f"{name}.pdf")):
        log_tail = ""
        log_path = os.path.join(tmp, f"{name}.log")
        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8", errors="replace") as fh:
                    log_tail = fh.read()[-1200:]
            except Exception:
                log_tail = r.stderr.decode("utf-8", errors="replace")[-500:]
        raise HTTPException(status_code=422, detail={"message": "LaTeX 编译失败", "log": log_tail})


@router.post("/api/tools/img2latex/compile", tags=["工具"])
def img2latex_compile(req: CompileRequest, current_user: User = Depends(get_current_user_obj)):
    """LaTeX 代码 → PDF（XeLaTeX 编译两遍以解析交叉引用）"""
    code = (req.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="请先生成或粘贴 LaTeX 代码")
    if shutil.which("xelatex") is None:
        raise HTTPException(status_code=503, detail="服务器未安装 LaTeX 编译引擎（xelatex），请联系管理员")
    if len(code) > 200_000:
        raise HTTPException(status_code=400, detail="LaTeX 代码过长（>200KB）")

    code = _sanitize_latex(code)
    tmp = tempfile.mkdtemp(prefix="anticraft_tex_")
    try:
        tex_path = os.path.join(tmp, "document.tex")
        with open(tex_path, "w", encoding="utf-8") as fh:
            fh.write(code)
        _run_xelatex(tmp, "document")
        _run_xelatex(tmp, "document")   # 第二遍解析目录/交叉引用
        with open(os.path.join(tmp, "document.pdf"), "rb") as fh:
            pdf = fh.read()
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": "inline; filename=document.pdf"})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=422, detail={"message": "编译超时（可能死循环或文档过大）", "log": ""})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"编译异常：{str(e)[:200]}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)