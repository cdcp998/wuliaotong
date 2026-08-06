"""认证接口：login / logout / me（《后端API设计.md》§1）。"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.deps import SUPER_ADMIN_ROLE_CODE, get_current_user
from app.core.response import BizError, E_LOGIN_FAILED, ok
from app.core.security import generate_session_token, verify_password
from app.db import get_db
from app.models.sys import (
    SysPermission,
    SysRole,
    SysRolePermission,
    SysSession,
    SysUser,
)
from app.schemas.auth import LoginReq, RoleInfo, UserInfo

router = APIRouter(prefix="/auth", tags=["认证"])


def _permission_codes(db: Session, user: SysUser) -> list[str]:
    """返回用户权限点 code 列表；超级管理员返回全部。"""
    role = db.get(SysRole, user.role_id)
    if role and role.code == SUPER_ADMIN_ROLE_CODE:
        codes = db.scalars(
            select(SysPermission.code).order_by(SysPermission.id)
        ).all()
    else:
        codes = db.scalars(
            select(SysPermission.code)
            .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
            .where(SysRolePermission.role_id == user.role_id)
            .order_by(SysPermission.id)
        ).all()
    return list(codes)


def build_user_info(db: Session, user: SysUser) -> UserInfo:
    role = db.get(SysRole, user.role_id)
    return UserInfo(
        id=user.id,
        username=user.username,
        real_name=user.real_name,
        role=RoleInfo(id=role.id, code=role.code, name=role.name) if role else None,
        permissions=_permission_codes(db, user),
    )


@router.post("/login")
def login(req: LoginReq, response: Response, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(SysUser).where(SysUser.username == req.username))
    if not user or not verify_password(req.password, user.password_hash):
        raise BizError(E_LOGIN_FAILED, "用户名或密码错误")
    if user.status != 1:
        raise BizError(E_LOGIN_FAILED, "账号已停用")

    token = generate_session_token()
    db.add(
        SysSession(
            session_id=token,
            user_id=user.id,
            expire_at=datetime.now() + timedelta(hours=settings.session_expire_hours),
        )
    )
    user.last_login_at = datetime.now()
    db.commit()

    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=int(settings.session_expire_hours * 3600),
    )
    return ok({"user": build_user_info(db, user)})


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        db.execute(SysSession.__table__.delete().where(SysSession.session_id == token))
        db.commit()
    response.delete_cookie(settings.session_cookie_name)
    return ok()


@router.get("/me")
def me(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return ok({"user": build_user_info(db, user)})
