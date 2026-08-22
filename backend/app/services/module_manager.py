"""模块生命周期管理（安装/启用/停用/升级/卸载，线缆和设备插件方案 §2.2 状态机）。

状态机：
    NOT_INSTALLED →[安装]→ INSTALLED →[启用]→ ENABLED ⇄[停用]→ DISABLED
    任何态 →[hook/SQL 异常]→ ERROR（记录 last_error，可重试）
    ENABLED →[升级]→ (应用新 migration) → 恢复原状态（代码需重启进程加载）
    DISABLED/INSTALLED/ERROR →[卸载]→ NOT_INSTALLED（不删表不删数据，重装幂等续用）

约定：
- 卸载绝不 DROP TABLE（数据红线）；重装时 MigrationRunner 幂等跳过已应用版本。
- 依赖不满足：禁止启用（写 ERROR + last_error），禁止该模块静默保持 ENABLED。
- 状态变更必须调用 invalidate_module_cache（commit 后）。
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.migration_runner import MigrationRunner, ModuleMigrationError
from app.core.modules import (
    ModuleContext,
    ModuleDef,
    ST_DISABLED,
    ST_ENABLED,
    ST_ERROR,
    ST_INSTALLED,
    ST_INSTALLING,
    ST_NOT_INSTALLED,
    ST_UPGRADING,
    _TRANSITION_LOCK,
    check_dependencies,
    get_module_def,
    invalidate_module_cache,
)
from app.core.response import BizError, E_BILL_STATUS, E_NOT_FOUND, E_PARAM
from app.models import SysModule

logger = logging.getLogger("app.module_manager")


def _get_row(db: Session, code: str) -> SysModule:
    row = db.scalar(select(SysModule).where(SysModule.code == code))
    if row is None:
        raise BizError(E_NOT_FOUND, f"模块 {code} 未登记")
    return row


def _get_def(code: str) -> ModuleDef:
    d = get_module_def(code)
    if d is None:
        raise BizError(E_PARAM, f"模块 {code} 源码未部署（请先运行 build_modules.py）")
    return d


def _mark_error(db: Session, code: str, reason: str) -> None:
    row = _get_row(db, code)
    row.state = ST_ERROR
    row.last_error = reason
    from datetime import datetime

    row.last_error_at = datetime.now()
    db.commit()
    invalidate_module_cache(code)
    logger.error("模块 %s 进入 ERROR：%s", code, reason)


def _run_hook(hook, db: Session, module: ModuleDef, ctx: ModuleContext, name: str) -> None:
    """执行生命周期钩子；异常 → 模块 ERROR（异常隔离，核心继续运行）。"""
    if hook is None:
        return
    try:
        hook(db, module, ctx)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _mark_error(db, module.code, f"{name} 钩子异常：{exc}")
        raise BizError(E_BILL_STATUS, f"模块{name}失败：{exc}") from exc


def install_module(db: Session, code: str, ctx: ModuleContext | None = None) -> SysModule:
    """安装：MigrationRunner（install.sql=baseline + 增量迁移）→ on_install 钩子 → INSTALLED。

    幂等：已安装且代码版本相同 → 直接返回；迁移已应用会自动跳过（数据保留续用）。
    """
    d = _get_def(code)
    row = _get_row(db, code)
    if row.state in _TRANSITION_LOCK:
        raise BizError(E_BILL_STATUS, f"模块正在{ '安装' if row.state == ST_INSTALLING else '升级'}中，请稍后再试")
    if row.state == ST_ENABLED:
        raise BizError(E_BILL_STATUS, "模块已启用，请先停用再重新安装")
    ctx = ctx or ModuleContext()

    row.state = ST_INSTALLING
    row.last_error = ""
    db.commit()
    invalidate_module_cache(code)
    try:
        MigrationRunner(db, code).run(d)
        _run_hook(d.on_install, db, d, ctx, "安装")
    except ModuleMigrationError as exc:
        _mark_error(db, code, str(exc))
        raise BizError(E_BILL_STATUS, str(exc)) from exc
    row = _get_row(db, code)
    row.state = ST_INSTALLED
    row.version = d.version
    row.installed_at = __import__("datetime").datetime.now()
    db.commit()
    invalidate_module_cache(code)
    logger.info("模块 %s 安装完成（version=%s, schema_version=%s）", code, d.version, row.schema_version)
    return row


def enable_module(db: Session, code: str, ctx: ModuleContext | None = None) -> SysModule:
    """启用：依赖校验 → on_enable 钩子 → ENABLED。依赖不满足 → ERROR + 拒绝。"""
    d = _get_def(code)
    row = _get_row(db, code)
    if row.state in _TRANSITION_LOCK:
        raise BizError(E_BILL_STATUS, "模块正在处理中，请稍后再试")
    if row.state == ST_ENABLED:
        return row  # 幂等
    if row.state == ST_NOT_INSTALLED:
        raise BizError(E_BILL_STATUS, "模块未安装，请先安装")
    ok, reason = check_dependencies(db, code, d.dependencies)
    if not ok:
        _mark_error(db, code, f"依赖不满足: {reason}")
        raise BizError(E_BILL_STATUS, f"依赖不满足: {reason}")
    ctx = ctx or ModuleContext()
    _run_hook(d.on_enable, db, d, ctx, "启用")
    row = _get_row(db, code)
    row.state = ST_ENABLED
    row.last_error = ""
    row.last_error_at = None
    db.commit()
    invalidate_module_cache(code)
    logger.info("模块 %s 已启用", code)
    return row


def disable_module(db: Session, code: str, ctx: ModuleContext | None = None) -> SysModule:
    """停用：on_disable 钩子 → DISABLED（数据保留，接口 403 + 菜单隐藏）。"""
    d = _get_def(code)
    row = _get_row(db, code)
    if row.state in _TRANSITION_LOCK:
        raise BizError(E_BILL_STATUS, "模块正在处理中，请稍后再试")
    if row.state == ST_DISABLED:
        return row  # 幂等
    if row.state != ST_ENABLED:
        raise BizError(E_BILL_STATUS, f"模块当前状态 {row.state}，无法停用")
    ctx = ctx or ModuleContext()
    _run_hook(d.on_disable, db, d, ctx, "停用")
    row = _get_row(db, code)
    row.state = ST_DISABLED
    db.commit()
    invalidate_module_cache(code)
    logger.info("模块 %s 已停用", code)
    return row


def upgrade_module(db: Session, code: str, ctx: ModuleContext | None = None) -> SysModule:
    """升级：应用新 migration（代码已随重启部署），完成后恢复原状态。

    方案：升级后需重启后端进程加载新代码（管理界面强制提示）——本操作只应用 SQL 与状态。
    """
    d = _get_def(code)
    row = _get_row(db, code)
    if row.state in _TRANSITION_LOCK:
        raise BizError(E_BILL_STATUS, "模块正在处理中，请稍后再试")
    if row.state == ST_NOT_INSTALLED:
        raise BizError(E_BILL_STATUS, "模块未安装，无法升级")
    if row.version == d.version:
        # 无版本变化：仍尝试应用缺失迁移（幂等），若确无新迁移则返回
        pass
    prev_state = row.state
    row.state = ST_UPGRADING
    db.commit()
    invalidate_module_cache(code)
    try:
        applied = MigrationRunner(db, code).run(d)
    except ModuleMigrationError as exc:
        _mark_error(db, code, str(exc))
        raise BizError(E_BILL_STATUS, str(exc)) from exc
    row = _get_row(db, code)
    row.state = prev_state if prev_state == ST_ENABLED else (prev_state if prev_state in (ST_DISABLED, ST_INSTALLED, ST_ERROR) else ST_INSTALLED)
    row.version = d.version
    row.last_error = ""
    row.last_error_at = None
    db.commit()
    invalidate_module_cache(code)
    logger.info("模块 %s 升级完成（applied=%s, version=%s）", code, applied, d.version)
    return row


def uninstall_module(db: Session, code: str, ctx: ModuleContext | None = None) -> SysModule:
    """卸载（不删表不删数据）：校验无启用依赖方 → on_uninstall 钩子 → NOT_INSTALLED。

    重装幂等：schema_version / migration 记录 / 业务数据全部保留。
    """
    d = _get_def(code)
    row = _get_row(db, code)
    if row.state in _TRANSITION_LOCK:
        raise BizError(E_BILL_STATUS, "模块正在处理中，请稍后再试")
    if row.state == ST_ENABLED:
        raise BizError(E_BILL_STATUS, "模块已启用，请先停用再卸载")
    if row.state == ST_NOT_INSTALLED:
        return row  # 幂等
    # 被依赖检查：任何已部署（非 NOT_INSTALLED）模块的依赖引用本模块 → 禁止卸载
    dependents = db.scalars(select(SysModule).where(SysModule.depends.is_not(None), SysModule.state != ST_NOT_INSTALLED)).all()
    for m in dependents:
        try:
            deps = json.loads(m.depends or "[]")
        except (TypeError, ValueError):
            continue
        if any(dep.split(">")[0].split("=")[0].split("<")[0].strip() == code for dep in deps):
            raise BizError(E_BILL_STATUS, f"模块被 {m.code} 依赖，禁止卸载")
    ctx = ctx or ModuleContext()
    _run_hook(d.on_uninstall, db, d, ctx, "卸载")
    row = _get_row(db, code)
    row.state = ST_NOT_INSTALLED
    row.last_error = ""
    row.last_error_at = None
    db.commit()
    invalidate_module_cache(code)
    logger.info("模块 %s 已卸载（表与数据保留，重装幂等续用）", code)
    return row


def module_desc(row: SysModule) -> dict:
    """模块行 → 前端用字典（含依赖解析后的可读描述）。"""
    try:
        deps = json.loads(row.depends or "[]")
    except (TypeError, ValueError):
        deps = []
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "version": row.version,
        "state": row.state,
        "schema_version": row.schema_version,
        "depends": deps,
        "description": row.description,
        "last_error": row.last_error,
        "last_error_at": row.last_error_at.isoformat() if row.last_error_at else None,
        "installed_at": row.installed_at.isoformat() if row.installed_at else None,
    }
