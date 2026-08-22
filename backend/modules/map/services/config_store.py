"""map 模块：模块配置存取（sys_module.config，敏感字段加密，方案 §5.10 / §13.6）。

- 配置存 map 模块的 sys_module.config（JSON）：
  {"map_sources": {key: {...}}, "cache": {"max_size": ..., "max_daily": ...}}
- api_secret/api_key 用 Fernet 加密存储：密钥取后端 data/.module_config_key（首启生成，0600），
  可被 MODULE_CONFIG_KEY 环境变量覆盖（部署时注入）。
- 接口返回一律脱敏（密文→"******"），永不下发明文/密文（方案 §5.10）。
- 兼容：图源配置原存于 cable 模块（cable 未拆分前），首次安装/启用时若 cable 配置
  已有 map_sources 则**迁移到 map 模块**，保留用户已编辑图源。
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.models import SysModule

logger = logging.getLogger("app.map.config")

MODULE_CODE = "map"
_SENSITIVE_KEYS = ("secret", "password", "key", "token")

_KEY_FILE = Path(os.getenv("MODULE_CONFIG_KEY_FILE", str(BASE_DIR / "data" / ".module_config_key")))


def _fernet() -> Fernet:
    key = os.getenv("MODULE_CONFIG_KEY", "")
    if key:
        return Fernet(key.encode() if isinstance(key, str) else key)
    if _KEY_FILE.exists():
        raw = _KEY_FILE.read_text(encoding="utf-8").strip()
        return Fernet(raw.encode())
    key = Fernet.generate_key()
    _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    _KEY_FILE.write_text(key.decode(), encoding="utf-8")
    try:
        os.chmod(_KEY_FILE, 0o600)
    except OSError:
        pass
    return Fernet(key)


def _encrypt(value: str) -> str:
    if not value:
        return ""
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def _decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        logger.warning("模块配置敏感字段解密失败（可能密钥变更）")
        return ""


def _mask_sensitive(obj) -> object:
    """递归脱敏：敏感键值 → "******"（保留 exists 标记由调用方处理）。"""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                out[k] = _mask_sensitive(v)
            elif any(s in str(k).lower() for s in _SENSITIVE_KEYS) and v:
                out[k] = "******"
            else:
                out[k] = v
        return out
    if isinstance(obj, list):
        return [_mask_sensitive(i) for i in obj]
    return obj


def load_config(db: Session) -> dict:
    """读取模块配置（敏感字段返回明文供后端使用；接口层用 mask_config）。"""
    row = db.scalar(select(SysModule).where(SysModule.code == MODULE_CODE))
    if row is None or not row.config:
        # 兼容迁移：map 配置为空时回读 cable 模块旧配置（拆分前图源存在 cable）
        return _legacy_from_cable(db)
    try:
        config = json.loads(row.config)
    except (TypeError, ValueError):
        return _legacy_from_cable(db)
    # 解密密文敏感字段
    for src in config.get("map_sources", {}).values():
        if isinstance(src, dict):
            for k in ("api_key", "api_secret", "api_token"):
                if src.get(k):
                    src[k] = _decrypt(str(src[k]))
    return config


def _legacy_from_cable(db: Session) -> dict:
    """读取 cable 模块旧配置（含 map_sources/cache；仅 map 相关键，敏感字段解密）。"""
    row = db.scalar(select(SysModule).where(SysModule.code == "cable"))
    if row is None or not row.config:
        return {"map_sources": {}, "cache": {}}
    try:
        config = json.loads(row.config)
    except (TypeError, ValueError):
        return {"map_sources": {}, "cache": {}}
    out = {"map_sources": config.get("map_sources") or {}, "cache": config.get("cache") or {}}
    for src in out["map_sources"].values():
        if isinstance(src, dict):
            for k in ("api_key", "api_secret", "api_token"):
                if src.get(k):
                    src[k] = _decrypt(str(src[k]))
    return out


def save_config(db: Session, config: dict) -> None:
    """保存模块配置（敏感字段先加密再入库）。"""
    for src in config.get("map_sources", {}).values():
        if isinstance(src, dict):
            for k in ("api_key", "api_secret", "api_token"):
                if src.get(k):
                    src[k] = _encrypt(str(src[k]))
    row = db.scalar(select(SysModule).where(SysModule.code == MODULE_CODE))
    if row is None:
        raise ValueError("map 模块未登记")
    row.config = json.dumps(config, ensure_ascii=False)
    db.commit()
    from app.core.modules import invalidate_module_cache

    invalidate_module_cache(MODULE_CODE)


def effective_config(db: Session) -> dict:
    """读取模块配置；map_sources 为空（从未保存过）时回退默认配置并**持久化写入配置库**。

    系统自带图源（默认 Esri）在安装/启用或首次访问时即落库（ensure_seeded），
    成为可测试/可编辑/可停用的真实配置；仅当源被全部删除时才再次回退内置默认。
    """
    config = load_config(db)
    if not config.get("map_sources"):
        return ensure_seeded(db)
    return config


def ensure_seeded(db: Session) -> dict:
    """把系统自带图源（默认 Esri + 缓存配额）写入配置数据库（幂等：config 为空才写）。

    由 map 模块 on_install/on_enable 钩子调用，保证「安装即持久化」；
    图源管理界面的「系统自带」源从此为真实配置（可测试/编辑/停用）。
    """
    config = load_config(db)
    if config.get("map_sources"):
        return config
    default = default_config()
    row = db.scalar(select(SysModule).where(SysModule.code == MODULE_CODE))
    if row is not None:
        row.config = json.dumps(default, ensure_ascii=False)
        db.commit()
    return default


def mask_config(config: dict) -> dict:
    """接口脱敏视图（不修改原对象）。"""
    import copy

    return _mask_sensitive(copy.deepcopy(config))


def default_config() -> dict:
    """初始地图源配置（Esri World Imagery，WGS84）。"""
    return {
        "map_sources": {
            "esri": {
                "name": "Esri 影像",
                "type": "esri",
                "coordinate_space": "wgs84",
                "url_template": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                "enabled": True,
                "api_key": "",
                "api_secret": "",
            }
        },
        "cache": {"max_size": 20 * 1024 * 1024 * 1024, "max_daily": 0},
    }
