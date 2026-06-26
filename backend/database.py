# database.py — 数据库连接与会话管理

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 指定 .env 路径为 backend/.env（与当前文件同目录）
_local_dotenv = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
_root_dotenv = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
_dotenv_path = _local_dotenv if os.path.exists(_local_dotenv) else _root_dotenv
load_dotenv(dotenv_path=_dotenv_path)

# ============================================
# 数据库配置（从 .env 读取）
# ============================================
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "anticraft")

# ── 自动检测可用的 MySQL 驱动 ──
# 优先使用 mysql-connector-python（本地开发），
# 回退到 pymysql（服务器环境）
DRIVER = None
for candidate, module_name in [
    ("mysql+mysqlconnector", "mysql.connector"),
    ("mysql+pymysql", "pymysql"),
]:
    try:
        __import__(module_name)
        DRIVER = candidate
        break
    except ImportError:
        continue

if DRIVER is None:
    raise ImportError(
        "找不到可用的 MySQL 驱动。请安装 mysql-connector-python 或 pymysql：\n"
        "  pip install mysql-connector-python==8.4.0\n"
        "  或 pip install pymysql"
    )

DATABASE_URL = (
    f"{DRIVER}://{DB_USER}:{DB_PASSWORD}"
    f"@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI 依赖注入 —— 每次请求获取一个数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """创建所有表（首次运行调用）"""
    Base.metadata.create_all(bind=engine)
