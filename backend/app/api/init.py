"""系统初始化安装接口（首次启动引导，《后端API设计.md》§1.1）。

初始化完成状态**仅以文件系统标记文件（backend/data/.initialized）是否存在判断**，
不依赖数据库状态——数据库重建/备份恢复不会导致强制重新进入初始化流程。
删除标记文件（并保留业务数据）即可重新进入初始化安装页。

- GET /init/status：未初始化时前端（电脑端入口/登录页/受保护路由，手机端登录页）强制跳转初始化安装页
- POST /init：仅未初始化时可执行（防重入）；写系统名称/联系电话 + 重置或创建内置超管账号
  事务提交成功后**原子写入标记文件**（临时文件 + os.replace，内容含完成时间），
  标记文件存在即代表初始化已可靠完成
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.deps import SUPER_ADMIN_ROLE_CODE
from app.core.response import BizError, E_FILE_FAILED, E_PARAM, ok
from app.core.security import hash_password
from app.db import get_db
from app.models.sys import SysConfig, SysRole, SysUser
from app.schemas.init import InitReq

logger = logging.getLogger("app.init")

router = APIRouter(prefix="/init", tags=["初始化安装"])

MARK_FILE = Path(settings.init_mark_file)


def is_initialized() -> bool:
    """初始化状态：仅检查标记文件是否存在（不触发任何数据库查询）。"""
    return MARK_FILE.exists()


def _write_mark_file() -> None:
    """原子写入初始化完成标记文件：先写临时文件再 os.replace，避免半写/并发覆盖。

    内容含完成时间便于排障；文件仅作存在性标记，内容不影响判断。
    """
    MARK_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = MARK_FILE.with_name(f".{MARK_FILE.name}.tmp")
    tmp.write_text(f"initialized_at={datetime.now():%Y-%m-%d %H:%M:%S}\n", encoding="utf-8")
    os.replace(tmp, MARK_FILE)


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
            "initialized": is_initialized(),
            "site_name": site.config_value if site else "",
        }
    )


@router.post("")
def do_init(req: InitReq, db: Session = Depends(get_db)) -> dict:
    """执行初始化（公开，仅未初始化时可执行）：写系统信息 + 重置/创建内置超管账号 + 写标记文件。"""
    if is_initialized():
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
    db.commit()
    # 事务提交成功后才写标记文件：标记文件存在 ⇔ 初始化业务数据已落库成功
    try:
        _write_mark_file()
    except OSError as exc:
        logger.error("初始化完成标记文件写入失败：%s", exc)
        raise BizError(E_FILE_FAILED, f"初始化完成标记写入失败（{exc}），请检查 {MARK_FILE.parent} 目录写入权限后重试") from exc
    logger.info("系统初始化完成：site_name=%s admin=%s", req.site_name, req.admin_username)
    return ok()
