"""task 模块（任务管理）：任务 CRUD/状态机/派发/维修记录/领用关联。

模块契约（方案 §2.2）：源码位于 backend/modules/task/，由 build_modules.py 部署到
backend/app/modules/task/。

依赖策略（软依赖）：不声明对 cable 的硬依赖——任务可不关联故障/线缆独立运行；
仅当任务关联了 fault/cable 时，运行期经 _cable_guard / module_enabled 兜底 403
（见 api.py）。cable 未启用时前端自动隐藏「关联故障」字段。
"""
from __future__ import annotations

__version__ = "1.1.0"

from app.core.modules import ModuleDef
from app.modules.task.api import router

module = ModuleDef(
    code="task",
    name="任务管理",
    version=__version__,
    router=router,
    dependencies=[],
    audit_labels={
        "tasks": "任务管理",
    },
    audit_actions={
        ("POST", "/tasks"): "新建维修任务",
        ("PUT", "/tasks/{id}"): "编辑维修任务",
        ("POST", "/tasks/{id}/assign"): "派发任务",
        ("POST", "/tasks/{id}/status"): "流转任务状态",
        ("POST", "/tasks/{id}/records"): "提交维修记录",
        ("POST", "/tasks/{id}/requisitions"): "任务关联领用单",
        ("POST", "/tasks/{id}/knowledge-recommend"): "生成知识推荐",
    },
    install_sql=["sql/install.sql"],
)
