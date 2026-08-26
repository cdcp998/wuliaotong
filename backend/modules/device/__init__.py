"""device 模块（设备管理）：设备台账/生命周期 + 设备维修任务（复用 task_engine）。

模块契约（方案 §2.2）：源码位于 backend/modules/device/。

依赖策略（v1.2 系统重构：**强依赖任务管理**）：
- dependencies=["task>=1.3.0,<2.0.0"]——任务管理是唯一的任务池与派发入口；
- 设备自有任务池机制（公开任务单/自行领取 open·hybrid 模式与 claim 接口）已移除：
  设备维修任务统一手动派发，经任务管理「统一任务池」（/tasks/pool）合并显示与派发；
- 任务→物料领用链接仍复用 task 模块的 task_requisition 表（强依赖下直接使用）。
"""
from __future__ import annotations

__version__ = "1.2.0"

from app.core.modules import ModuleDef
from app.modules.device.api import router

module = ModuleDef(
    code="device",
    name="设备管理",
    version=__version__,
    router=router,
    dependencies=["task>=1.3.0,<2.0.0"],
    audit_labels={
        "devices": "设备",
        "device-tasks": "设备故障管理",
    },
    install_sql=["sql/install.sql"],
)
