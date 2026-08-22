"""模块插件机制核心（线缆和设备插件方案 §2.2 / §13.1）。

- ModuleDef：模块契约（版本/路由/依赖/生命周期钩子/jobs/workers）。
- discover_modules：扫描运行时目录 ``app/modules/{code}``（scripts/build_modules.py 管线产物）。
- module_enabled：fail-closed 判定（Redis 快路径 → MySQL 回源 → 异常拒绝）。
- require_module_enabled：FastAPI 依赖（非 ENABLED → 4009「模块未启用」HTTP 403）。
- register_modules：应用启动加载器（登记模块记录、依赖校验、挂载路由、汇总审计标签/任务）。

约定（与方案一致）：
- 生命周期三分：源码存在 ≠ 已安装 ≠ 已启用；启动不自动安装。
- 模块路由**启动时全部挂载**，但每个模块 router 自带 require_module_enabled(code) 依赖：
  停用/未安装时接口直接 403（即时生效、无需重启）；**代码级改动（升级）需重启进程**。
- 依赖不满足 → state=ERROR（写 last_error），不挂载该模块路由也不允许 ENABLED 静默不一致。
"""
from __future__ import annotations

import importlib
import json
import logging
import pkgutil
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import Depends
from fastapi.routing import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.cache import cache_delete, cache_get, cache_set
from app.core.migration_utils import table_exists
from app.core.response import BizError, E_MODULE_DISABLED
from app.db import get_db
from app.models.sys import SysModule

logger = logging.getLogger("app.modules")

# 模块状态常量
ST_NOT_INSTALLED = "NOT_INSTALLED"
ST_INSTALLING = "INSTALLING"
ST_INSTALLED = "INSTALLED"
ST_ENABLED = "ENABLED"
ST_DISABLED = "DISABLED"
ST_ERROR = "ERROR"
ST_UPGRADING = "UPGRADING"

# 不可变终态/进行中状态：不允许直接安装/启用等常规操作
_TRANSITION_LOCK = (ST_INSTALLING, ST_UPGRADING)

_MODULE_STATE_CACHE_TTL = 300  # 模块启用状态缓存秒数（状态变更时显式失效）


@dataclass
class ModuleContext:
    """生命周期钩子上下文（操作者信息，后台任务为空）。"""

    actor_id: int = 0
    actor_name: str = ""


@dataclass
class ModuleDef:
    """模块定义（模块包 __init__.py 中声明为 ``module = ModuleDef(...)``）。

    生命周期钩子签名固定（幂等、可重入、异常安全）：
    on_install(db, module, ctx) / on_enable(db, module, ctx) / on_disable(db, module, ctx) /
    on_uninstall(db, module, ctx)
    """

    code: str
    name: str
    version: str  # SemVer
    router: APIRouter | None = None  # 模块全部接口（router 级 require_module_enabled(code)）
    dependencies: list[str] = field(default_factory=list)  # 如 ["cable>=1.2.0,<2.0.0"]
    audit_labels: dict[str, str] = field(default_factory=dict)  # URL 首段 → 中文模块名
    install_sql: list[str] = field(default_factory=list)  # 如 ["sql/install.sql"]
    migrations_dir: str = "sql/migrations"
    migration_executors: dict[str, Callable] = field(default_factory=dict)  # 文件名 → python 执行函数
    on_install: Callable | None = None
    on_enable: Callable | None = None
    on_disable: Callable | None = None
    on_uninstall: Callable | None = None
    jobs: list[Callable] = field(default_factory=list)  # APScheduler job 工厂（tick 检查 ENABLED）
    workers: list[Callable] = field(default_factory=list)  # 后台 worker 工厂（异常隔离）


# ============================ 注册表与发现 ============================

_defs: dict[str, ModuleDef] = {}


def get_module_defs() -> dict[str, ModuleDef]:
    """已发现模块定义（code → ModuleDef）。"""
    return dict(_defs)


def get_module_def(code: str) -> ModuleDef | None:
    return _defs.get(code)


def discover_modules() -> list[ModuleDef]:
    """扫描 ``app.modules`` 包下已部署模块（运行时目录，管线生成）。

    单个模块 import 失败 → 记录告警并跳过（异常隔离，核心继续运行，方案 §13.1.8）。
    """
    global _defs
    found: dict[str, ModuleDef] = {}
    try:
        import app.modules as pkg
    except ImportError:
        logger.info("app.modules 包不存在（尚未运行 build_modules.py），跳过模块发现")
        _defs = {}
        return []

    for info in pkgutil.iter_modules(pkg.__path__):
        if info.name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"app.modules.{info.name}")
            m = getattr(mod, "module", None)
            if isinstance(m, ModuleDef):
                if m.code in found:
                    logger.warning("模块编码重复：%s（%s 与 %s），忽略后者", m.code, info.name, found[m.code].name)
                    continue
                found[m.code] = m
            else:
                logger.warning("app.modules.%s 未定义 module = ModuleDef(...)，跳过", info.name)
        except Exception as exc:  # noqa: BLE001 模块包异常不得影响核心启动
            logger.warning("加载模块 %s 失败，已跳过：%s", info.name, exc)
    _defs = found
    return list(found.values())


def module_audit_labels() -> dict[str, str]:
    """汇总各模块审计标签（URL 首段 → 中文模块名），供 main.py 合并进操作日志映射。"""
    labels: dict[str, str] = {}
    for d in _defs.values():
        labels.update(d.audit_labels)
    return labels


def all_module_jobs() -> list[Callable]:
    return [job for d in _defs.values() for job in d.jobs]


def all_module_workers() -> list[Callable]:
    return [worker for d in _defs.values() for worker in d.workers]


# ============================ 状态判定（fail-closed） ============================

def invalidate_module_cache(code: str) -> None:
    """模块状态变更后失效启用状态缓存（与事务同函数内、commit 之后调用，规范 §4.10）。"""
    cache_delete(f"module:{code}")


def module_enabled(db: Session, code: str) -> bool:
    """模块是否启用（fail-closed）。

    Redis ``wlt:module:{code}`` 命中 → 直接返回；miss/异常 → 回源 MySQL sys_module.state；
    MySQL 异常/无记录 → False（拒绝模块访问，禁止 fail-open 泄漏模块接口）。
    """
    cached = cache_get(f"module:{code}")
    if cached == 1:
        return True
    if cached == 0:
        return False
    try:
        row = db.scalar(select(SysModule).where(SysModule.code == code))
        enabled = bool(row and row.state == ST_ENABLED)
    except Exception:  # noqa: BLE001 fail-closed：数据库异常时拒绝模块访问
        logger.warning("module_enabled(%s) 数据库异常，按未启用处理", code)
        return False
    cache_set(f"module:{code}", 1 if enabled else 0, _MODULE_STATE_CACHE_TTL)
    return enabled


def enabled_module_codes(db: Session) -> set[str]:
    """当前全部已启用模块编码（单次查询；菜单/权限过滤用）。"""
    try:
        rows = db.scalars(select(SysModule.code).where(SysModule.state == ST_ENABLED)).all()
        return set(rows)
    except Exception:  # noqa: BLE001 表不存在/异常 → 视为无启用模块
        return set()


def require_module_enabled(code: str):
    """FastAPI 依赖：模块未启用（非 ENABLED）返回 4009「模块未启用」（HTTP 403，方案 §13.1.2）。"""

    def checker(db: Session = Depends(get_db)) -> None:
        if not module_enabled(db, code):
            raise BizError(E_MODULE_DISABLED, "模块未启用", http_status=403)

    return checker


# ============================ SemVer 依赖校验 ============================

def _parse_semver(version: str) -> tuple[int, int, int] | None:
    parts = version.strip().lstrip("vV").split(".")
    try:
        nums = [int(p) for p in parts[:3]]
    except ValueError:
        return None
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums[:3])  # type: ignore[return-value]


def _satisfies(version: str, constraint: str) -> bool:
    """version 是否满足形如 ``>=1.2.0,<2.0.0`` 的约束（逗号分隔，全部满足）。"""
    v = _parse_semver(version)
    if v is None:
        return False
    for clause in constraint.split(","):
        clause = clause.strip()
        if not clause:
            continue
        for op in (">=", "<=", ">", "<", "=", "~", "^"):
            if clause.startswith(op):
                target = _parse_semver(clause[len(op):].strip())
                if target is None:
                    return False
                if op == ">=":
                    if v < target:
                        return False
                elif op == "<=":
                    if v > target:
                        return False
                elif op == ">":
                    if v <= target:
                        return False
                elif op == "<":
                    if v >= target:
                        return False
                elif op == "=":
                    if v != target:
                        return False
                elif op == "~":
                    if v < target or v[:2] != target[:2]:  # ~1.2.3 → >=1.2.3,<1.3.0
                        return False
                elif op == "^":
                    if v < target or v[0] != target[0]:  # ^1.2.3 → >=1.2.3,<2.0.0
                        return False
                break
        else:
            return False  # 无法解析的约束
    return True


def check_dependencies(db: Session, code: str, dependencies: list[str]) -> tuple[bool, str]:
    """校验模块依赖是否满足（方案：依赖不满足 → ERROR，不允许 ENABLED 静默不一致）。

    返回 (是否满足, 不满足原因)；满足时 reason 为空串。
    """
    for dep in dependencies:
        if "<" in dep or ">" in dep or "=" in dep:
            # 形如 cable>=1.2.0,<2.0.0
            import re

            m = re.match(r"^([A-Za-z0-9_-]+)(.*)$", dep)
            if not m:
                return False, f"依赖格式无法解析：{dep}"
            dep_code, constraint = m.group(1), m.group(2)
        else:
            dep_code, constraint = dep.strip(), ""
        row = db.scalar(select(SysModule).where(SysModule.code == dep_code))
        if row is None:
            return False, f"依赖模块不存在：{dep_code}"
        if row.state != ST_ENABLED:
            return False, f"依赖模块未启用：{dep_code}（当前 {row.state}）"
        if constraint and not _satisfies(row.version, constraint):
            return False, f"依赖版本不满足：{dep}（当前 {row.version}）"
    return True, ""


# ============================ 启动加载器 ============================

def register_modules(app: Any) -> dict[str, Any]:
    """应用启动加载器（main.py 在 include_router 之后调用）。

    1. 读 sys_module（表不存在/未初始化 → 跳过，模块机制未就绪）
    2. 遍历 app/modules/ 下 ModuleDef：
       - 无记录 → 插入 state=NOT_INSTALLED（仅登记，不自动安装）
       - state=ENABLED 且依赖满足 → 保持；依赖不满足 → 置 ERROR（last_error）
       - 其余状态不干预
    3. 路由全部挂载（模块 router 自带 require_module_enabled 依赖，非 ENABLED 即时 403）
    4. 返回挂载摘要（供日志/测试断言）
    """
    defs = discover_modules()
    summary = {"modules": [d.code for d in defs], "mounted": [], "registered": 0}
    if not defs:
        return summary

    from app.db import SessionLocal

    db = SessionLocal()
    try:
        if not table_exists(db, "sys_module"):
            logger.info("sys_module 表不存在（未初始化/旧库），模块注册表跳过：%s", [d.code for d in defs])
            return summary
        for d in defs:
            row = db.scalar(select(SysModule).where(SysModule.code == d.code))
            if row is None:
                db.add(
                    SysModule(
                        code=d.code,
                        name=d.name,
                        version=d.version,
                        state=ST_NOT_INSTALLED,
                        depends=json.dumps(d.dependencies, ensure_ascii=False) if d.dependencies else None,
                        description=d.name,
                    )
                )
                summary["registered"] += 1
            else:
                # 依赖/名称声明同步（模块依赖变更或改名时随重启生效，保证 dependents/check 使用最新声明）
                if row.name != d.name:
                    row.name = d.name
                try:
                    cur_deps = json.loads(row.depends or "[]")
                except (TypeError, ValueError):
                    cur_deps = []
                if cur_deps != list(d.dependencies):
                    row.depends = json.dumps(d.dependencies, ensure_ascii=False) if d.dependencies else None
                if row.state == ST_ENABLED:
                    ok, reason = check_dependencies(db, d.code, d.dependencies)
                    if not ok:
                        row.state = ST_ERROR
                        row.last_error = f"依赖不满足: {reason}"
                        row.last_error_at = __import__("datetime").datetime.now()
                        logger.warning("模块 %s 依赖不满足，置 ERROR：%s", d.code, reason)
            db.commit()
        # 挂载路由（全部挂载、依赖门控）
        for d in defs:
            if d.router is not None:
                app.include_router(d.router, prefix="/api/v1")
                summary["mounted"].append(d.code)
    except Exception as exc:  # noqa: BLE001 加载器异常不得阻断核心启动
        logger.warning("register_modules 失败（模块机制降级）：%s", exc)
        db.rollback()
    finally:
        db.close()
    return summary


def set_module_state(db: Session, code: str, state: str, last_error: str = "") -> SysModule:
    """更新模块状态并失效缓存（生命周期操作内部使用）。"""
    row = db.scalar(select(SysModule).where(SysModule.code == code))
    if row is None:
        raise BizError(4003, f"模块 {code} 未登记")
    row.state = state
    row.last_error = last_error
    if last_error:
        row.last_error_at = __import__("datetime").datetime.now()
    else:
        row.last_error = ""
        row.last_error_at = None
    db.commit()
    invalidate_module_cache(code)
    return row
