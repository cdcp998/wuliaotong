"""应用配置：从环境变量 / backend/.env 读取（禁止硬编码密钥）。"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]  # backend/
load_dotenv(BASE_DIR / ".env")


class Settings:
    app_name: str = "物料通管理系统"
    api_prefix: str = "/api/v1"

    # 数据库
    db_url: str = os.getenv(
        "DB_URL",
        "mysql+pymysql://root:cdcp520@127.0.0.1:3306/wuliaotong?charset=utf8mb4",
    )

    # 会话
    session_cookie_name: str = os.getenv("SESSION_COOKIE_NAME", "session_id")
    session_expire_hours: float = float(os.getenv("SESSION_EXPIRE_HOURS", "8"))
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "false").lower() == "true"

    # 跨域（前端 dev）
    cors_origins: list[str] = [
        o.strip()
        for o in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://localhost:5174",
        ).split(",")
        if o.strip()
    ]

    # OCR 引擎：rapidocr / paddle
    ocr_engine: str = os.getenv("OCR_ENGINE", "rapidocr")


settings = Settings()
