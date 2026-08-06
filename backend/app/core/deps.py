"""FastAPI 依赖注入：当前用户、权限校验（《后端API设计.md》§0）。"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.response import BizError, E_LOGIN_FAILED, E_NO_PERMISSION
from app.db import get_db
from app.models.sys import SysPermission, SysRole, SysRolePermission, SysSession, SysUser

SUPER_ADMIN_ROLE_CODE = "super_admin"


def resolve_session_user(db: Session, token: str | None) -> SysUser | None:
    """按 Cookie 中的会话令牌解析用户；无效/过期返回 None（审计中间件复用）。"""
    if not token:
        return None
    sess = db.scalar(select(SysSession).where(SysSession.session_id == token))
    if not sess or sess.expire_at < datetime.now():
        return None
    user = db.get(SysUser, sess.user_id)
    if not user or user.status != 1:
        return None
    # 滑动续期：剩余不足一半时延长
    remain = sess.expire_at - datetime.now()
    if remain < timedelta(hours=settings.session_expire_hours) / 2:
        sess.expire_at = datetime.now() + timedelta(hours=settings.session_expire_hours)
        db.commit()
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> SysUser:
    """要求登录；未登录返回 4004 + 401。"""
    user = resolve_session_user(db, request.cookies.get(settings.session_cookie_name))
    if user is None:
        raise BizError(E_LOGIN_FAILED, "未登录或会话已过期", http_status=401)
    return user


def require_permission(code: str):
    """权限点校验（§10）；超级管理员自动放行。"""

    def checker(
        user: SysUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> SysUser:
        role = db.get(SysRole, user.role_id)
        if role and role.code == SUPER_ADMIN_ROLE_CODE:
            return user
        has = db.scalar(
            select(SysRolePermission.id)
            .join(SysPermission, SysPermission.id == SysRolePermission.permission_id)
            .where(
                SysRolePermission.role_id == user.role_id,
                SysPermission.code == code,
            )
        )
        if has is None:
            raise BizError(E_NO_PERMISSION, "无权限", http_status=403)
        return user

    return checker
