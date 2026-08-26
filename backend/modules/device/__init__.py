"""device 模块（设备管理）：设备台账/生命周期 + 设备维修任务（复用 task_engine）。

模块契约（方案 §2.2）：源码位于 backend/modules/device/。

依赖策略（v1.1 起无硬依赖）：不声明对 task 的依赖——设备维修任务/任务池可独立运行
（task 为增强管理模块）。仅「任务→物料领用链接」复用 task 模块的 task_requisition 表，
作为增强功能在运行期经 module_enabled("task") 守卫：task 未启用时领用关联接口 403，
其余功能不受影响。
"""
from __future__ import annotations

__version__ = "1.1.0"

from app.core.modules import ModuleDef
from app.modules.device.api import router

module = ModuleDef(
    code="device",
    name="设备管理",
    version=__version__,
    router=router,
    dependencies=[],
    audit_labels={
        "devices": "设备",
        "device-tasks": "设备维修任务",
    },
    install_sql=["sql/install.sql"],
)
