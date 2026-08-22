"""模块管理接口（核心，权限 module:manage；线缆和设备插件方案 §2.4 / §6.1）。

- GET /modules：列表（版本/状态/依赖/菜单数/权限点数/SQL 版本/checksum 前缀/是否部署）
- GET /modules/{code}：详情（config 脱敏）
- POST /modules/{code}/install|enable|disable|upgrade|uninstall：生命周期操作（幂等，支持 Idempotency-Key）
- POST /modules/rescan：重新扫描模块源码（只读预检 build_modules.py --check-only，不改数据库）
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys

from fastapi import APIRouter, Depends, Header
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.core.deps import get_current_user, require_permission
from app.core.modules import ModuleContext, get_module_def, get_module_defs
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models import SysModule
from app.models.sys import SysMenu, SysPermission
from app.services.module_manager import (
    disable_module,
    enable_module,
    install_module,
    module_desc,
    uninstall_module,
    upgrade_module,
)

logger = logging.getLogger("app.modules_api")

router = APIRouter(tags=["模块管理"], dependencies=[Depends(get_current_user)])

_RUNTIME_MANIFEST = BASE_DIR / "app" / "modules" / "manifest.json"


def _load_manifest() -> dict:
    try:
        if _RUNTIME_MANIFEST.exists():
            return json.loads(_RUNTIME_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("读取 manifest.json 失败：%s", exc)
    return {}


def _mask_config(config: dict | None) -> dict | None:
    """配置脱敏：secret/password/key/token 等字段值打码（前端永不下发明文）。"""
    if not config:
        return config
    masked = dict(config)

    def _mask(obj: dict) -> dict:
        out = {}
        for k, v in obj.items():
            if isinstance(v, dict):
                out[k] = _mask(v)
            elif isinstance(v, (list, tuple)):
                out[k] = [_mask(i) if isinstance(i, dict) else i for i in v]
            elif any(s in k.lower() for s in ("secret", "password", "key", "token", "sign")) and v:
                out[k] = "******"
            else:
                out[k] = v
        return out

    return _mask(masked)


def _list_row(db: Session, row: SysModule, manifest: dict) -> dict:
    m = get_module_def(row.code)
    manifest_info = manifest.get(row.code) or {}
    menu_count = db.scalar(select(func.count()).select_from(SysMenu).where(SysMenu.module_code == row.code)) or 0
    perm_count = db.scalar(select(func.count()).select_from(SysPermission).where(SysPermission.module_code == row.code)) or 0
    out = module_desc(row)
    out.update(
        {
            "deployed": m is not None,
            "source_version": m.version if m else None,
            "source_checksum": manifest_info.get("checksum", ""),
            "source_checksum_prefix": manifest_info.get("checksum", "")[:12],
            "build_id": manifest_info.get("build_id", ""),
            "source_commit": manifest_info.get("source_commit", ""),
            "menu_count": menu_count,
            "perm_count": perm_count,
            "config": _mask_config(json.loads(row.config) if row.config else None),
        }
    )
    return out


@router.get("/modules")
def list_modules(db: Session = Depends(get_db)) -> dict:
    """模块列表（含版本漂移信息：source_version ≠ version → 可升级；checksum 不符 → 代码校验失败）。"""
    manifest = _load_manifest()
    rows = db.scalars(select(SysModule).order_by(SysModule.id)).all()
    data = [_list_row(db, r, manifest) for r in rows]
    # 源码已部署但库中无记录的模块也返回（提示未登记/可安装）
    known = {r.code for r in rows}
    for code, d in get_module_defs().items():
        if code not in known:
            data.append(
                {
                    "id": 0,
                    "code": code,
                    "name": d.name,
                    "version": d.version,
                    "state": "NOT_INSTALLED",
                    "schema_version": "0",
                    "depends": d.dependencies,
                    "description": d.name,
                    "last_error": "",
                    "last_error_at": None,
                    "installed_at": None,
                    "deployed": True,
                    "source_version": d.version,
                    "source_checksum": manifest.get(code, {}).get("checksum", ""),
                    "source_checksum_prefix": manifest.get(code, {}).get("checksum", "")[:12],
                    "build_id": manifest.get(code, {}).get("build_id", ""),
                    "source_commit": manifest.get(code, {}).get("source_commit", ""),
                    "menu_count": 0,
                    "perm_count": 0,
                    "config": None,
                }
            )
    return ok(data)


@router.get("/modules/{code}", dependencies=[Depends(require_permission("module:manage"))])
def module_detail(code: str, db: Session = Depends(get_db)) -> dict:
    """模块详情（config 脱敏；仅模块管理权限可见）。"""
    row = db.scalar(select(SysModule).where(SysModule.code == code))
    if row is None:
        raise BizError(E_NOT_FOUND, f"模块 {code} 未登记")
    return ok(_list_row(db, row, _load_manifest()))


def _do_action(code: str, action: str, db: Session, idempotency_key: str | None) -> dict:
    ctx = ModuleContext(actor_id=0, actor_name="")  # 操作者由审计中间件记录
    if action == "install":
        row = install_module(db, code, ctx)
    elif action == "enable":
        row = enable_module(db, code, ctx)
    elif action == "disable":
        row = disable_module(db, code, ctx)
    elif action == "upgrade":
        row = upgrade_module(db, code, ctx)
    elif action == "uninstall":
        row = uninstall_module(db, code, ctx)
    else:
        raise BizError(E_PARAM, f"未知操作：{action}")
    data = module_desc(row)
    # 升级后强制提示重启（方案 v2.1 ⑪）
    if action == "upgrade":
        data["need_restart"] = True
    return ok(data)


@router.post("/modules/{code}/install", dependencies=[Depends(require_permission("module:manage"))])
def api_install(code: str, db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> dict:
    return _do_action(code, "install", db, idempotency_key)


@router.post("/modules/{code}/enable", dependencies=[Depends(require_permission("module:manage"))])
def api_enable(code: str, db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> dict:
    return _do_action(code, "enable", db, idempotency_key)


@router.post("/modules/{code}/disable", dependencies=[Depends(require_permission("module:manage"))])
def api_disable(code: str, db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> dict:
    return _do_action(code, "disable", db, idempotency_key)


@router.post("/modules/{code}/upgrade", dependencies=[Depends(require_permission("module:manage"))])
def api_upgrade(code: str, db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> dict:
    return _do_action(code, "upgrade", db, idempotency_key)


@router.post("/modules/{code}/uninstall", dependencies=[Depends(require_permission("module:manage"))])
def api_uninstall(code: str, db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> dict:
    return _do_action(code, "uninstall", db, idempotency_key)


@router.post("/modules/rescan", dependencies=[Depends(require_permission("module:manage"))])
def api_rescan() -> dict:
    """「重新扫描模块源码」（只读预检）：等价 build_modules.py --check-only，不改数据库。

    返回新模块/版本变化/代码漂移列表，供升级前预检。
    """
    script = BASE_DIR / "scripts" / "build_modules.py"
    if not script.exists():
        raise BizError(E_NOT_FOUND, "build_modules.py 不存在")
    try:
        proc = subprocess.run(
            [sys.executable, "-u", str(script), "--check-only"],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise BizError(E_PARAM, "扫描超时（120s）") from None
    if proc.returncode != 0:
        raise BizError(E_PARAM, f"扫描失败：{proc.stderr.strip()[:300]}")
    try:
        return ok(json.loads(proc.stdout))
    except ValueError:
        return ok({"raw": proc.stdout})
