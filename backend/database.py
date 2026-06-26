# database.py — 数据库连接与会话管理

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 优先使用根目录的 .env（本机开发环境），
# 回退到 backend/.env（服务器环境）
_root_dotenv = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
_local_dotenv = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
_dotenv_path = _root_dotenv if os.path.exists(_root_dotenv) else _local_dotenv
load_dotenv(dotenv_path=_dotenv_path, override=True)

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


def run_migrations():
    """自动迁移：为已有表补充新增字段（init_db 只建表不迁移）"""
    import secrets as _secrets
    insp = inspect(engine)
    with engine.connect() as conn:
        # users 表新增 role 列
        if insp.has_table("users"):
            columns = {c["name"] for c in insp.get_columns("users")}
            if "role" not in columns:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'"
                ))
                conn.commit()
        # blogs 表新增 category 列（兼容旧版本）
        if insp.has_table("blogs"):
            columns = {c["name"] for c in insp.get_columns("blogs")}
            if "category" not in columns:
                conn.execute(text(
                    "ALTER TABLE blogs ADD COLUMN category VARCHAR(50) NULL AFTER title"
                ))
                conn.commit()
        # invite_codes 表新增 is_reusable / owner_user_id 列
        if insp.has_table("invite_codes"):
            columns = {c["name"] for c in insp.get_columns("invite_codes")}
            if "is_reusable" not in columns:
                conn.execute(text(
                    "ALTER TABLE invite_codes ADD COLUMN is_reusable TINYINT(1) NOT NULL DEFAULT 0"
                ))
                conn.commit()
            if "owner_user_id" not in columns:
                conn.execute(text(
                    "ALTER TABLE invite_codes ADD COLUMN owner_user_id INT NULL"
                ))
                conn.execute(text(
                    "ALTER TABLE invite_codes ADD CONSTRAINT fk_invite_owner "
                    "FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE"
                ))
                conn.commit()

    # 为所有没有专属邀请码的已存在用户分配一个邀请码
    from sqlalchemy.orm import Session
    from models import User, InviteCode
    with Session(engine) as db:
        # 找出已有专属邀请码的用户 ID
        existing_owner_ids = {
            row[0] for row in db.query(InviteCode.owner_user_id)
            .filter(InviteCode.owner_user_id.isnot(None))
            .all()
        }
        # 为没有专属邀请码的用户生成一个
        users_without_code = (
            db.query(User)
            .filter(~User.id.in_(existing_owner_ids) if existing_owner_ids else True)
            .all()
        )
        for u in users_without_code:
            code = _secrets.token_urlsafe(8).upper().replace("-", "").replace("_", "")[:12]
            invite = InviteCode(
                code=code,
                created_by=u.id,
                owner_user_id=u.id,
                is_reusable=True,  # 用户专属邀请码默认可重复使用
            )
            db.add(invite)
        if users_without_code:
            db.commit()

        # 将 end 用户提升为管理员（部署后初始化管理员账号）
        end_user = db.query(User).filter(User.username == "end").first()
        if end_user and end_user.role != "admin":
            end_user.role = "admin"
            db.commit()
            print("[migrations] user 'end' promoted to admin")

