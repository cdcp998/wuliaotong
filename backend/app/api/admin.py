"""系统管理接口（P7，《后端API设计.md》§9）：用户/角色/权限/操作日志/备份。

保护规则：内置 admin 不可停用/删除；不可修改自己的角色与状态（防锁死）；
super_admin 角色权限不可改；内置角色不可删；有用户引用的角色不可删。
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import SUPER_ADMIN_ROLE_CODE, get_current_user, require_permission
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.core.security import hash_password
from app.db import get_db
from app.models.sys import (
    SysBackupLog,
    SysPermission,
    SysRole,
    SysRolePermission,
    SysOperationLog,
    SysUser,
)
from app.schemas.admin import (
    BackupOut,
    RoleCreateReq,
    RoleOut,
    RolePermReq,
    RoleUpdateReq,
    UserCreateReq,
    UserOut,
    UserUpdateReq,
)
from app.schemas.stock import PageData
from app.services.backup import backup_dir, cleanup_auto_backups, run_backup

router = APIRouter(tags=["系统管理"], dependencies=[Depends(get_current_user)])


def _user_out(db: Session, u: SysUser) -> dict:
    role = db.get(SysRole, u.role_id)
    return UserOut(
        id=u.id, username=u.username, real_name=u.real_name, phone=u.phone,
        role_id=u.role_id, role_name=role.name if role else "",
        status=u.status, last_login_at=u.last_login_at, created_at=u.created_at,
    ).model_dump()


# ============================ 用户管理 ============================


@router.get("/users", dependencies=[Depends(require_permission("sys:user"))])
def list_users(
    keyword: str = Query("", max_length=50),
    status: int | None = Query(None),
    role_id: int = Query(0),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(SysUser)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(or_(SysUser.username.like(like), SysUser.real_name.like(like), SysUser.phone.like(like)))
    if status is not None:
        stmt = stmt.where(SysUser.status == status)
    if role_id:
        stmt = stmt.where(SysUser.role_id == role_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(SysUser.id).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[_user_out(db, u) for u in rows], total=total, page=page, page_size=page_size).model_dump())


@router.post("/users", dependencies=[Depends(require_permission("sys:user"))])
def create_user(req: UserCreateReq, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(SysUser.id).where(SysUser.username == req.username)):
        raise BizError(E_PARAM, "用户名已存在")
    if db.get(SysRole, req.role_id) is None:
        raise BizError(E_PARAM, "角色不存在")
    u = SysUser(
        username=req.username,
        password_hash=hash_password(req.password),
        real_name=req.real_name,
        phone=req.phone,
        role_id=req.role_id,
        status=1,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return ok({"id": u.id, "username": u.username})


@router.put("/users/{user_id}", dependencies=[Depends(require_permission("sys:user"))])
def update_user(
    user_id: int,
    req: UserUpdateReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    u = db.get(SysUser, user_id)
    if u is None:
        raise BizError(E_NOT_FOUND, "用户不存在")
    is_self = u.id == user.id
    # 防锁死：不能修改自己的角色/状态（可改自己的姓名电话密码）
    if is_self and (req.role_id is not None or req.status is not None):
        raise BizError(E_PARAM, "不能修改自己的角色或启用状态")
    # 内置 admin（id=1）不可停用
    if u.id == 1 and req.status == 0:
        raise BizError(E_PARAM, "内置超级管理员不可停用")
    if req.role_id is not None:
        if db.get(SysRole, req.role_id) is None:
            raise BizError(E_PARAM, "角色不存在")
        u.role_id = req.role_id
    if req.status is not None:
        u.status = req.status
    if req.real_name is not None:
        u.real_name = req.real_name
    if req.phone is not None:
        u.phone = req.phone
    if req.password:
        u.password_hash = hash_password(req.password)
    db.commit()
    return ok()


@router.delete("/users/{user_id}", dependencies=[Depends(require_permission("sys:user"))])
def delete_user(
    user_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if user_id == user.id:
        raise BizError(E_PARAM, "不能停用自己的账号")
    u = db.get(SysUser, user_id)
    if u is None:
        raise BizError(E_NOT_FOUND, "用户不存在")
    if u.id == 1:
        raise BizError(E_PARAM, "内置超级管理员不可停用")
    u.status = 0  # 逻辑停用，保留历史数据
    db.commit()
    return ok()


# ============================ 角色与权限 ============================


def _role_out(db: Session, r: SysRole) -> dict:
    perms = db.scalars(
        select(SysPermission).join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
        .where(SysRolePermission.role_id == r.id).order_by(SysPermission.id)
    ).all()
    return RoleOut(
        id=r.id, code=r.code, name=r.name, description=r.description,
        is_builtin=r.is_builtin,
        permission_ids=[p.id for p in perms],
        permission_codes=[p.code for p in perms],
    ).model_dump()


@router.get("/roles", dependencies=[Depends(require_permission("sys:role"))])
def list_roles(db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(SysRole).order_by(SysRole.id)).all()
    return ok([_role_out(db, r) for r in rows])


@router.get("/permissions", dependencies=[Depends(require_permission("sys:role"))])
def list_permissions(db: Session = Depends(get_db)) -> dict:
    """全部权限点（扁平列表，前端按 id 勾选）。"""
    rows = db.scalars(select(SysPermission).order_by(SysPermission.sort, SysPermission.id)).all()
    return ok([{"id": p.id, "parent_id": p.parent_id, "name": p.name, "code": p.code, "type": p.type} for p in rows])


@router.post("/roles", dependencies=[Depends(require_permission("sys:role"))])
def create_role(req: RoleCreateReq, db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(SysRole.id).where(SysRole.code == req.code)):
        raise BizError(E_PARAM, "角色编码已存在")
    r = SysRole(code=req.code, name=req.name, description=req.description, is_builtin=0)
    db.add(r)
    db.commit()
    db.refresh(r)
    return ok({"id": r.id, "code": r.code})


@router.put("/roles/{role_id}", dependencies=[Depends(require_permission("sys:role"))])
def update_role(role_id: int, req: RoleUpdateReq, db: Session = Depends(get_db)) -> dict:
    r = db.get(SysRole, role_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "角色不存在")
    if req.name is not None:
        r.name = req.name
    if req.description is not None:
        r.description = req.description
    db.commit()
    return ok()


@router.delete("/roles/{role_id}", dependencies=[Depends(require_permission("sys:role"))])
def delete_role(role_id: int, db: Session = Depends(get_db)) -> dict:
    r = db.get(SysRole, role_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "角色不存在")
    if r.is_builtin:
        raise BizError(E_PARAM, "内置角色不可删除")
    if db.scalar(select(func.count()).select_from(SysUser).where(SysUser.role_id == role_id, SysUser.status == 1)):
        raise BizError(E_PARAM, "该角色下还有启用用户，请先调整用户角色")
    db.execute(SysRolePermission.__table__.delete().where(SysRolePermission.role_id == role_id))
    db.delete(r)
    db.commit()
    return ok()


@router.put("/roles/{role_id}/permissions", dependencies=[Depends(require_permission("sys:role"))])
def update_role_permissions(role_id: int, req: RolePermReq, db: Session = Depends(get_db)) -> dict:
    r = db.get(SysRole, role_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "角色不存在")
    if r.code == SUPER_ADMIN_ROLE_CODE:
        raise BizError(E_PARAM, "超级管理员角色权限固定为全部，不可修改")
    # 校验权限点存在
    valid = set(db.scalars(select(SysPermission.id)).all())
    bad = [pid for pid in req.permission_ids if pid not in valid]
    if bad:
        raise BizError(E_PARAM, f"权限点不存在：{bad}")
    db.execute(SysRolePermission.__table__.delete().where(SysRolePermission.role_id == role_id))
    for pid in req.permission_ids:
        db.add(SysRolePermission(role_id=role_id, permission_id=pid))
    db.commit()
    return ok()


# ============================ 操作日志 ============================


@router.get("/logs", dependencies=[Depends(require_permission("sys:log"))])
def list_logs(
    username: str = Query("", max_length=50),
    module: str = Query("", max_length=50),
    method: str = Query("", max_length=10),
    start: str = Query(""),
    end: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(SysOperationLog)
    if username:
        stmt = stmt.where(SysOperationLog.username.like(f"%{username}%"))
    if module:
        stmt = stmt.where(SysOperationLog.module == module)
    if method:
        stmt = stmt.where(SysOperationLog.method == method)
    if start:
        stmt = stmt.where(SysOperationLog.created_at >= f"{start} 00:00:00")
    if end:
        stmt = stmt.where(SysOperationLog.created_at <= f"{end} 23:59:59")
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(SysOperationLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    out = [
        {
            "id": log.id, "user_id": log.user_id, "username": log.username,
            "module": log.module, "action": log.action, "method": log.method,
            "url": log.url, "params": log.params[:500], "ip": log.ip,
            "duration_ms": log.duration_ms, "created_at": log.created_at,
        }
        for log in rows
    ]
    return ok(PageData(list=out, total=total, page=page, page_size=page_size).model_dump())


# ============================ 备份 ============================


@router.post("/backups", dependencies=[Depends(require_permission("sys:backup"))])
def create_backup(db: Session = Depends(get_db)) -> dict:
    log = run_backup(db, "manual")
    return ok({"id": log.id, "file_path": log.file_path, "file_size": log.file_size})


@router.get("/backups", dependencies=[Depends(require_permission("sys:backup"))])
def list_backups(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(SysBackupLog)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(SysBackupLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[BackupOut.model_validate(b, from_attributes=True).model_dump() for b in rows], total=total, page=page, page_size=page_size).model_dump())


@router.delete("/backups/{backup_id}", dependencies=[Depends(require_permission("sys:backup"))])
def delete_backup(backup_id: int, db: Session = Depends(get_db)) -> dict:
    log = db.get(SysBackupLog, backup_id)
    if log is None:
        raise BizError(E_NOT_FOUND, "备份记录不存在")
    try:
        (backup_dir() / log.file_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(log)
    db.commit()
    return ok()


@router.get("/backups/{backup_id}/download", dependencies=[Depends(require_permission("sys:backup"))])
def download_backup(backup_id: int, db: Session = Depends(get_db)) -> FileResponse:
    log = db.get(SysBackupLog, backup_id)
    if log is None:
        raise BizError(E_NOT_FOUND, "备份记录不存在")
    path = backup_dir() / log.file_path
    if not path.exists():
        raise BizError(E_NOT_FOUND, "备份文件已丢失")
    return FileResponse(path, filename=log.file_path, media_type="application/gzip")
