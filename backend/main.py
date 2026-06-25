# main.py — FastAPI 应用入口

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from database import get_db, init_db
from models import User
from schemas import RegisterRequest, LoginRequest, TokenResponse, UserResponse
from auth import hash_password, verify_password, create_access_token, decode_access_token

# ============================================
# 应用初始化
# ============================================

app = FastAPI(title="anticraft API", version="1.0.0")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

# CORS —— 允许前端开发服务器跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    """首次启动自动建表"""
    init_db()


# ============================================
# API 路由
# ============================================

@app.get("/api/health", tags=["系统"])
def health_check():
    """健康检查"""
    return {"status": "ok", "message": "anticraft API is running"}


@app.post("/api/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, tags=["认证"])
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """用户注册"""

    existing = db.query(User).filter(
        (User.username == req.username) | (User.email == req.email)
    ).first()
    if existing:
        field = "用户名" if existing.username == req.username else "邮箱"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{field}已被注册",
        )

    user = User(
        username=req.username,
        email=req.email,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id), "username": user.username})

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@app.post("/api/login", response_model=TokenResponse, tags=["认证"])
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """用户登录"""

    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    token = create_access_token({"sub": str(user.id), "username": user.username})

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@app.get("/api/user/me", response_model=UserResponse, tags=["用户"])
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """获取当前登录用户信息（需 Bearer Token）"""
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")

    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    return UserResponse.model_validate(user)


# ============================================
# 启动入口
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
