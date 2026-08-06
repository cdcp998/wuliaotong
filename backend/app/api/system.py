"""系统接口：health、系统设置（OCR 引擎/大模型 API 等，管理员后台维护，《后端API设计.md》§9）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.core.deps import require_permission
from app.core.response import BizError, E_PARAM, ok
from app.db import get_db
from app.models.sys import SysConfig
from app.services.ocr.client import ocr_engine_available

router = APIRouter(tags=["系统"])  # health 公开（运维探活）；settings 单独要求 sys:config

# 可配置项：str = 明文；secret = 密钥（GET 脱敏、PUT 传掩码/空不修改）
SETTINGS_KEYS: dict[str, str] = {
    "site.name": "str",
    "session.expire_hours": "str",
    "ocr.engine": "str",  # rapidocr / paddle
    "bill.rule": "str",
    "llm.doubao.api_key": "secret",
    "llm.doubao.base_url": "str",
    "llm.doubao.model": "str",
    "llm.deepseek.api_key": "secret",
    "llm.deepseek.base_url": "str",
    "llm.deepseek.model": "str",
    # 注册与找回（本轮需求）
    "auth.register_mode": "str",  # open 开放 / closed 关闭 / review 审核
    "auth.forgot_method": "str",  # email 邮箱找回 / phone 电话 / both
    "site.contact_phone": "str",  # 管理员联系电话（电话找回展示）
    "smtp.host": "str",
    "smtp.port": "str",
    "smtp.user": "str",
    "smtp.password": "secret",
    "smtp.from": "str",
}


def _mask(value: str) -> str:
    return f"****{value[-4:]}" if len(value) > 4 else "****"


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.engine"))
    engine = cfg.config_value if cfg and cfg.config_value else settings.ocr_engine
    return ok(
        {
            "status": "ok",
            "db": "ok",
            "ocr_engine": engine,
            "ocr_ready": ocr_engine_available(engine),
        }
    )


@router.get("/settings", dependencies=[Depends(require_permission("sys:config"))])
def get_settings(db: Session = Depends(get_db)) -> dict:
    """读取系统设置；密钥脱敏（只显示 **** 后四位）。"""
    out: dict[str, str] = {}
    for key, kind in SETTINGS_KEYS.items():
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
        value = cfg.config_value if cfg else ""
        out[key] = _mask(value) if kind == "secret" and value else value
    return ok(out)


@router.put("/settings", dependencies=[Depends(require_permission("sys:config"))])
def update_settings(body: dict[str, str], db: Session = Depends(get_db)) -> dict:
    """部分更新系统设置；密钥字段传空或掩码（****）表示不修改。"""
    for key, value in body.items():
        if key not in SETTINGS_KEYS:
            raise BizError(E_PARAM, f"未知配置项: {key}")
        if SETTINGS_KEYS[key] == "secret":
            if not value or value.startswith("****"):
                continue  # 不修改密钥
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
        if cfg is None:
            db.add(SysConfig(config_key=key, config_value=str(value), remark="系统设置"))
        else:
            cfg.config_value = str(value)
    db.commit()
    return ok()
