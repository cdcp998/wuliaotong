"""FastAPI 依赖注入：当前用户、权限校验（《后端API设计.md》§0）。

热路径优化（Redis 缓存层）：
- 会话解析：Redis ``session:{token}`` 存 token→user_id（TTL=会话时长，原生过期）。
  命中后仅需一次 user 主键查询；未命中回源 MySQL（兼容 Redis 接入前已有会话）并回填。
- 权限校验：按 role_id 缓存角色 code 与权限点集合（TTL 5 分钟），角色权限变更时显式失效。
- Redis 不可用时所有缓存操作静默降级为直查数据库，行为与接入前一致。
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.cache import cache_aside, cache_delete, session_get, session_renew, session_set
from app.core.response import BizError, E_LOGIN_FAILED, E_NO_PERMISSION
from app.db import get_db
from app.models.sys import SysConfig, SysPermission, SysRole, SysRolePermission, SysSession, SysUser

SUPER_ADMIN_ROLE_CODE = "super_admin"

_ROLE_CACHE_TTL = 300  # 角色/权限缓存 5 分钟
_SESSION_CFG_CACHE_TTL = 60  # 系统设置 session.expire_hours 的进程内缓存秒数
_session_cfg_cache: dict = {"value": None, "ts": 0.0}


def _role_cache_key(role_id: int) -> str:
    return f"role:{role_id}"


def _role_perms_cache_key(role_id: int) -> str:
    return f"role_perms:{role_id}"


def invalidate_role_cache(role_id: int) -> None:
    """角色信息/权限变更后失效缓存（admin 角色管理接口调用）。"""
    cache_delete(_role_cache_key(role_id), _role_perms_cache_key(role_id))


def invalidate_session_cfg_cache() -> None:
    """系统设置保存 session.expire_hours 后调用，使其立即对后续登录/续期生效。"""
    _session_cfg_cache["value"] = None
    _session_cfg_cache["ts"] = 0.0


def _session_expire_hours(db: Session) -> float:
    """普通会话时长（小时）：优先读 sys_config session.expire_hours（系统设置页可改），
    未配置/非法/数据库异常时回退环境变量 SESSION_EXPIRE_HOURS。进程内缓存 60 秒。
    """
    import time as _time

    now = _time.monotonic()
    if _session_cfg_cache["value"] is not None and now - _session_cfg_cache["ts"] < _SESSION_CFG_CACHE_TTL:
        return float(_session_cfg_cache["value"])
    value = settings.session_expire_hours
    try:
        row = db.scalar(select(SysConfig).where(SysConfig.config_key == "session.expire_hours"))
        if row and row.config_value:
            parsed = float(row.config_value)
            if 0 < parsed <= 720:
                value = parsed
    except Exception:  # noqa: BLE001 数据库异常按环境变量默认值处理
        pass
    _session_cfg_cache["value"] = value
    _session_cfg_cache["ts"] = now
    return value


def resolve_session_user(db: Session, token: str | None) -> SysUser | None:
    """按 Cookie 中的会话令牌解析用户；无效/过期返回 None（审计中间件复用）。

    Redis 命中（token→user_id）→ 直接按主键查用户（校验启用状态，安全语义不变）；
    Redis 未命中 → 回源 MySQL 会话表（兼容旧会话）并回填 Redis。
    会话 TTL 以 MySQL sys_session 的 expire_at-created_at 为总时长，保证「记住登录状态」
    （如 30 天）在 Redis 回填/续期后不会被普通会话默认时长（8 小时）覆盖。
    """
    if not token:
        return None

    # 快路径：Redis 会话缓存
    user_id = session_get(token)
    if user_id is not None:
        user = db.get(SysUser, user_id)
        if user and user.status == 1:
            session_renew(token)  # 滑动续期：按会话 meta 中的总时长判断阈值
            return user
        # 用户不存在/停用：清理无效会话缓存
        cache_delete(f"session:{token}", f"session_meta:{token}")
        return None

    # 慢路径：回源 MySQL（Redis 未命中或不可用）
    sess = db.scalar(select(SysSession).where(SysSession.session_id == token))
    if not sess or sess.expire_at < datetime.now():
        return None
    user = db.get(SysUser, sess.user_id)
    if not user or user.status != 1:
        return None
    now = datetime.now()
    remain = sess.expire_at - now
    total = sess.expire_at - sess.created_at if sess.created_at else timedelta(0)
    if total <= timedelta(0):
        total = timedelta(hours=_session_expire_hours(db))
    # 回填 Redis：TTL=剩余时长，meta=总会话时长（后续快路径续期按总时长判断）
    session_set(
        token,
        user.id,
        max(int(remain.total_seconds()), 1),
        int(total.total_seconds()),
    )
    # 滑动续期：剩余不足总时长一半时延长（与 Redis TTL 对齐）
    if remain < total / 2:
        sess.expire_at = now + total
        db.commit()
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> SysUser:
    """要求登录；未登录返回 4004 + 401。"""
    user = resolve_session_user(db, request.cookies.get(settings.session_cookie_name))
    if user is None:
        raise BizError(E_LOGIN_FAILED, "未登录或会话已过期", http_status=401)
    return user


def require_permission(code: str):
    """权限点校验（§10）；超级管理员自动放行。角色与权限集合缓存 5 分钟。"""

    def checker(
        user: SysUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> SysUser:
        # 缓存存 JSON 安全的 role.code 字符串（ORM 对象不可序列化）
        role_code = cache_aside(_role_cache_key(user.role_id), _ROLE_CACHE_TTL,
                                lambda: _load_role_code(db, user.role_id))
        if role_code == SUPER_ADMIN_ROLE_CODE:
            return user
        perms = cache_aside(_role_perms_cache_key(user.role_id), _ROLE_CACHE_TTL,
                            lambda: _load_role_perms(db, user.role_id))
        if code not in perms:
            raise BizError(E_NO_PERMISSION, "无权限", http_status=403)
        return user

    return checker


def require_any_permission(*codes: str):
    """权限点校验（任一命中即放行）；超级管理员自动放行。供跨模块写场景使用，
    如 AI 建议处理页内联维护材料分类（ai:suggestion 或 base:category 任一即可）。"""

    def checker(
        user: SysUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> SysUser:
        role_code = cache_aside(_role_cache_key(user.role_id), _ROLE_CACHE_TTL,
                                lambda: _load_role_code(db, user.role_id))
        if role_code == SUPER_ADMIN_ROLE_CODE:
            return user
        perms = cache_aside(_role_perms_cache_key(user.role_id), _ROLE_CACHE_TTL,
                            lambda: _load_role_perms(db, user.role_id))
        if not any(code in perms for code in codes):
            raise BizError(E_NO_PERMISSION, "无权限", http_status=403)
        return user

    return checker


# 删除审核等管理动作：管理者及以上角色（super_admin / manager）
MANAGER_ROLE_CODES = ("super_admin", "manager")


def require_manager_role():
    """管理者及以上角色校验（如删除审核批准/驳回）；超级管理员自动放行。"""

    def checker(
        user: SysUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> SysUser:
        role_code = cache_aside(_role_cache_key(user.role_id), _ROLE_CACHE_TTL,
                                lambda: _load_role_code(db, user.role_id))
        if role_code not in MANAGER_ROLE_CODES:
            raise BizError(E_NO_PERMISSION, "需要管理者及以上角色", http_status=403)
        return user

    return checker


def _load_role_code(db: Session, role_id: int) -> str | None:
    role = db.get(SysRole, role_id)
    return role.code if role else None


def _load_role_perms(db: Session, role_id: int) -> list[str]:
    """从数据库加载某角色全部权限点 code（超级管理员返回全部，保持原语义）。"""
    role = db.get(SysRole, role_id)
    if role and role.code == SUPER_ADMIN_ROLE_CODE:
        return list(db.scalars(select(SysPermission.code)).all())
    return list(
        db.scalars(
            select(SysPermission.code)
            .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
            .where(SysRolePermission.role_id == role_id)
        ).all()
    )
