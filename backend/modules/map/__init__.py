"""map 模块（地图）：图源配置 / 瓦片代理 / 缓存区域批量下载。

从 cable 模块拆分而来（地图工作台 + 地图缓存管理独立为地图模块；地图为基础设施）：
- 被 cable 模块依赖（cable 线缆/故障页面使用地图组件做选点/展示；启用顺序：map → cable）。
- 模块契约（方案 §2.2）：源码位于 backend/modules/map/，由 build_modules.py 复制到
  backend/app/modules/map/ 供运行时加载；生命周期由管理界面触发（安装/启停/升级/卸载）。
- 配置兼容：拆分前图源配置存 cable 模块 sys_module.config，map 首次读写时自动迁移。
"""
from __future__ import annotations

__version__ = "1.0.0"

from sqlalchemy import text

from app.core.modules import ModuleDef, ModuleContext
from app.modules.map.api import router
from app.modules.map.services.config_store import ensure_seeded
from app.modules.map.services.download_worker import download_worker_tick

_MAP_PATHS = ("/cable/map", "/cable/cache")


def _normalize_menu_perms(db) -> None:
    """菜单/权限归属归一（幂等）：地图工作台/缓存管理菜单与 map:config/map:cache 权限归属 map 模块。

    兼容：cable 拆分前菜单/权限挂在 cable（历史库）；cable install.sql 可能重复补种
    （NOT EXISTS 按旧目录判断）——统一挂到 map 顶级目录「地图」并清理重复行。
    安装/启用钩子均调用，任意安装顺序/重装后最终归属一致。
    """
    # 顶级目录「地图」（幂等）
    db.execute(text(
        "INSERT INTO sys_menu (parent_id, name, path, icon, perm_code, visible, sort, module_code) "
        "SELECT 0, '地图', '', 'GlobalOutlined', '', 1, 46, 'map' "
        "WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE parent_id = 0 AND name = '地图' AND module_code = 'map')"
    ))
    # 归属划转：cable 侧（或位置不对）的地图菜单行 → map 模块 + 地图目录
    db.execute(text(
        "UPDATE sys_menu SET module_code = 'map', parent_id = ("
        "  SELECT id FROM (SELECT id FROM sys_menu WHERE parent_id = 0 AND name = '地图' AND module_code = 'map') t"
        ") WHERE path IN ('/cable/map', '/cable/cache') AND (module_code = 'cable' OR parent_id <> ("
        "  SELECT id FROM (SELECT id FROM sys_menu WHERE parent_id = 0 AND name = '地图' AND module_code = 'map') t"
        "))"
    ))
    # 重复行清理：同一 path 的 map 行仅保留 id 最小一条
    db.execute(text(
        "DELETE s2 FROM sys_menu s2 "
        "JOIN (SELECT path, MIN(id) AS mid FROM sys_menu WHERE path IN ('/cable/map', '/cable/cache') AND module_code = 'map' GROUP BY path) k "
        "ON s2.path = k.path AND s2.module_code = 'map' AND s2.id <> k.mid"
    ))
    # 权限归属划转
    db.execute(text(
        "UPDATE sys_permission SET module_code = 'map' "
        "WHERE code IN ('map:config', 'map:cache') AND module_code = 'cable'"
    ))
    db.commit()


def _seed_sources(db, module, ctx: ModuleContext | None = None) -> None:
    """安装/启用即持久化系统自带图源 + 菜单/权限归属归一（幂等）。"""
    _normalize_menu_perms(db)
    ensure_seeded(db)


def _migrate_0001(db) -> None:
    """0001_add_task_source.sql：map_download_task.source 列（幂等：column_exists 判断）。"""
    from app.core.migration_utils import column_exists

    if not column_exists(db, "map_download_task", "source"):
        db.execute(text(
            "ALTER TABLE map_download_task ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT '' "
            "COMMENT '地图源 key（下载任务生成时记录）' AFTER region_id"
        ))


module = ModuleDef(
    code="map",
    name="地图",
    version=__version__,
    router=router,
    dependencies=[],
    audit_labels={"map": "地图"},
    install_sql=["sql/install.sql"],
    migration_executors={"0001_add_task_source.sql": _migrate_0001},
    on_install=_seed_sources,
    on_enable=_seed_sources,
    jobs=[download_worker_tick],  # 瓦片批量下载（tick 校验 ENABLED）
)
