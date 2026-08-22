"""cable 模块（线缆管理）：线缆/标记点/故障/卫星地图/瓦片代理/测距导航。

模块契约（方案 §2.2）：源码位于 backend/modules/cable/，由 build_modules.py 复制到
backend/app/modules/cable/ 供运行时加载；生命周期由管理界面触发（安装/启停/升级/卸载）。
"""
from __future__ import annotations

__version__ = "1.0.0"

from app.core.modules import ModuleDef, ModuleContext
from app.modules.cable.api import router
from app.modules.cable.services.config_store import ensure_seeded
from app.modules.cable.services.download_worker import download_worker_tick


def _seed_default_sources(db, module, ctx: ModuleContext | None = None) -> None:
    """系统自带图源写入配置库（安装/启用即持久化；幂等，图源管理可测试/编辑，不再仅虚拟回退）。"""
    ensure_seeded(db)


# 生命周期钩子（幂等、可重入）：安装/启用时落库系统自带图源


def _migrate_0001(db) -> None:
    """0001_add_task_source.sql：map_download_task.source 列（幂等：column_exists 判断）。"""
    from sqlalchemy import text

    from app.core.migration_utils import column_exists

    if not column_exists(db, "map_download_task", "source"):
        db.execute(text(
            "ALTER TABLE map_download_task ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT '' "
            "COMMENT '地图源 key（下载任务生成时记录）' AFTER region_id"
        ))


def _migrate_0002(db) -> None:
    """0002_add_fault_deleted.sql：cable_fault.deleted 软删除列（幂等）。"""
    from sqlalchemy import text

    from app.core.migration_utils import column_exists

    if not column_exists(db, "cable_fault", "deleted"):
        db.execute(text(
            "ALTER TABLE cable_fault ADD COLUMN deleted TINYINT NOT NULL DEFAULT 0 "
            "COMMENT '软删除：1=已删除（错误标点，前端不再展示）' AFTER status"
        ))


module = ModuleDef(
    code="cable",
    name="线缆管理",
    version=__version__,
    router=router,
    dependencies=[],
    audit_labels={
        "cables": "线缆",
        "faults": "故障",
        "geo": "定位",
        "map": "地图",
    },
    install_sql=["sql/install.sql"],
    migration_executors={"0001_add_task_source.sql": _migrate_0001, "0002_add_fault_deleted.sql": _migrate_0002},
    on_install=_seed_default_sources,
    on_enable=_seed_default_sources,
    jobs=[download_worker_tick],  # 瓦片批量下载（tick 校验 ENABLED）
)
