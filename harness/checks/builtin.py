# checks/builtin.py — 内置检查：通用 + anticraft 后端集成
from __future__ import annotations

import os
import sys
import urllib.request

from ..core.types import CheckResult, RiskLevel

BACKEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend")
REPO_ROOT = os.path.dirname(BACKEND_DIR)


def env_presence(*keys: str) -> CheckResult:
    """检查必需环境变量（DB_* / SECRET_KEY），自动读取仓库根 .env。"""
    env = dict(os.environ)
    dotenv_path = os.path.join(REPO_ROOT, ".env")
    if os.path.exists(dotenv_path):
        try:
            with open(dotenv_path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, val = line.split("=", 1)
                        env.setdefault(key.strip(), val.strip())
        except OSError:
            pass
    missing = [k for k in keys if not env.get(k)]
    if missing:
        return CheckResult("env_presence", False, "缺失环境变量: " + ", ".join(missing), RiskLevel.HIGH)
    return CheckResult("env_presence", True, "环境变量齐备")


def http_health(url: str, timeout: float = 5.0) -> CheckResult:
    name = f"http:{url}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            ok = 200 <= resp.status < 300
            return CheckResult(name, ok, f"HTTP {resp.status}")
    except Exception as exc:
        return CheckResult(name, False, f"{exc!r}", RiskLevel.CRITICAL)


def _load_backend(name: str):
    """懒加载 backend 模块：本目录不依赖 backend，失败时由调用方兜底。"""
    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)
    import importlib
    return importlib.import_module(name)


def db_connectivity() -> CheckResult:
    """后端数据库连通性：SELECT 1。"""
    try:
        from sqlalchemy import text
        db = _load_backend("database")
        with db.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return CheckResult("db_connectivity", True, "SELECT 1 ok")
    except Exception as exc:
        return CheckResult("db_connectivity", False, f"{exc!r}", RiskLevel.CRITICAL)


def migration_consistency() -> CheckResult:
    """对比 models.py 表列与数据库实际列，发现 schema 漂移（提醒补 run_migrations）。"""
    try:
        from sqlalchemy import inspect
        db = _load_backend("database")
        models = _load_backend("models")
        insp = inspect(db.engine)
        drift = {}
        for table, model in (("users", models.User), ("blogs", models.Blog),
                             ("comments", models.Comment), ("invite_codes", models.InviteCode)):
            if not insp.has_table(table):
                drift[table] = ["<表不存在>"]
                continue
            actual = {c["name"] for c in insp.get_columns(table)}
            wanted = {c.name for c in model.__table__.columns}
            diff = wanted - actual
            if diff:
                drift[table] = sorted(diff)
        if drift:
            msg = "; ".join(f"{t}:{','.join(cols)}" for t, cols in drift.items())
            return CheckResult("migration_consistency", False, "schema 漂移: " + msg, RiskLevel.HIGH)
        return CheckResult("migration_consistency", True, "表结构与 models 一致")
    except Exception as exc:
        return CheckResult("migration_consistency", False, f"check error: {exc!r}", RiskLevel.MEDIUM)


def jwt_roundtrip() -> CheckResult:
    """JWT 自检：生成 → 解码。"""
    try:
        auth = _load_backend("auth")
        token = auth.create_access_token({"sub": "1"})
        payload = auth.decode_access_token(token)
        if payload and payload.get("sub") == "1":
            return CheckResult("jwt_roundtrip", True, "token 编解码正常")
        return CheckResult("jwt_roundtrip", False, "token 解码结果不一致", RiskLevel.HIGH)
    except Exception as exc:
        return CheckResult("jwt_roundtrip", False, f"{exc!r}", RiskLevel.HIGH)
