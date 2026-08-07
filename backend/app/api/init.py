"""系统初始化安装接口（首次启动引导，《后端API设计.md》§1.1）。

- GET /init/status：未初始化时前端（电脑端入口/登录页/受保护路由，手机端登录页）强制跳转初始化安装页
- POST /init：仅未初始化时可执行（防重入）；写系统名称/联系电话 + 重置或创建内置超管账号 + 标记 sys.initialized=1
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import SUPER_ADMIN_ROLE_CODE
from app.core.response import BizError, E_PARAM, ok
from app.core.security import hash_password
from app.db import get_db
from app.models.sys import SysConfig, SysRole, SysUser
from app.schemas.init import InitReq

logger = logging.getLogger("app.init")

router = APIRouter(prefix="/init", tags=["初始化安装"])

INIT_KEY = "sys.initialized"


def is_initialized(db: Session) -> bool:
    """初始化状态：sys_config.sys.initialized == '1'；无记录（已有部署库）视为未初始化。"""
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == INIT_KEY))
    return cfg is not None and cfg.config_value == "1"


def _set_config(db: Session, key: str, value: str) -> None:
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    if cfg:
        cfg.config_value = value
    else:
        db.add(SysConfig(config_key=key, config_value=value, remark=""))


@router.get("/status")
def init_status(db: Session = Depends(get_db)) -> dict:
    """初始化状态（公开）：{initialized, site_name}。"""
    site = db.scalar(select(SysConfig).where(SysConfig.config_key == "site.name"))
    return ok(
        {
            "initialized": is_initialized(db),
            "site_name": site.config_value if site else "",
        }
    )


@router.post("")
def do_init(req: InitReq, db: Session = Depends(get_db)) -> dict:
    """执行初始化（公开，仅未初始化时可执行）：写系统信息 + 重置/创建内置超管账号。"""
    if is_initialized(db):
        raise BizError(E_PARAM, "系统已完成初始化，不能重复执行")

    role = db.scalar(select(SysRole).where(SysRole.code == SUPER_ADMIN_ROLE_CODE))
    if role is None:
        raise BizError(E_PARAM, "系统角色数据缺失，无法完成初始化")
    admin = db.scalar(
        select(SysUser).where(SysUser.role_id == role.id).order_by(SysUser.id).limit(1)
    )
    # 改名冲突校验：目标账号已被其他用户占用（含大小写不敏感的唯一约束由 DB 兜底）
    conflict = db.scalar(
        select(SysUser).where(
            SysUser.username == req.admin_username,
            SysUser.id != (admin.id if admin else -1),
        )
    )
    if conflict is not None:
        raise BizError(E_PARAM, f"管理员账号「{req.admin_username}」已被占用，请更换")

    if admin:
        admin.username = req.admin_username
        admin.password_hash = hash_password(req.admin_password)
        admin.real_name = "超级管理员"
        admin.status = 1
    else:
        db.add(
            SysUser(
                username=req.admin_username,
                password_hash=hash_password(req.admin_password),
                real_name="超级管理员",
                role_id=role.id,
                status=1,
            )
        )
    _set_config(db, "site.name", req.site_name)
    if req.contact_phone:
        _set_config(db, "site.contact_phone", req.contact_phone)
    _set_config(db, INIT_KEY, "1")
    db.commit()
    logger.info("系统初始化完成：site_name=%s admin=%s", req.site_name, req.admin_username)
    return ok()
