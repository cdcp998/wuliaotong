"""device 模块（设备管理）：设备台账/生命周期 + 设备维修任务（复用 task_engine）。

模块契约（方案 §2.2）：源码位于 backend/modules/device/；依赖 task>=1.0.0,<2.0.0
（任务→物料领用链接复用 task 模块的 task_requisition 表，避免并行领用体系）。
"""
from __future__ import annotations

__version__ = "1.0.0"

from app.core.modules import ModuleDef
from app.modules.device.api import router

def _migrate_0001(db) -> None:
    """0001_create_device_file.sql：device_file 设备图片关联表（幂等）。"""
    from app.core.migration_utils import table_exists

    if not table_exists(db, "device_file"):
        from sqlalchemy import text

        db.execute(text(
            "CREATE TABLE IF NOT EXISTS device_file ("
            "  id BIGINT NOT NULL AUTO_INCREMENT,"
            "  device_id BIGINT NOT NULL COMMENT '→ device.id',"
            "  file_id BIGINT NOT NULL COMMENT '→ sys_file.id',"
            "  sort_order INT NOT NULL DEFAULT 0,"
            "  created_by BIGINT NOT NULL DEFAULT 0,"
            "  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"
            "  PRIMARY KEY (id),"
            "  KEY idx_device (device_id)"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='设备图片'"
        ))


module = ModuleDef(
    code="device",
    name="设备管理",
    version=__version__,
    router=router,
    dependencies=["task>=1.0.0,<2.0.0"],
    audit_labels={
        "devices": "设备",
        "device-tasks": "设备维修任务",
    },
    install_sql=["sql/install.sql"],
    migration_executors={"0001_create_device_file.sql": _migrate_0001},
)
