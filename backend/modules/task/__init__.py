"""task 模块（维修任务）：任务 CRUD/状态机/派发/维修记录/领用关联。

模块契约（方案 §2.2）：源码位于 backend/modules/task/，由 build_modules.py 部署到
backend/app/modules/task/；依赖 cable>=1.0.0,<2.0.0（模块管理器校验，依赖不满足 → ERROR）。
"""
from __future__ import annotations

__version__ = "1.0.0"

from app.core.modules import ModuleDef
from app.modules.task.api import router

module = ModuleDef(
    code="task",
    name="维修任务",
    version=__version__,
    router=router,
    dependencies=["cable>=1.0.0,<2.0.0"],
    audit_labels={
        "tasks": "维修任务",
    },
    install_sql=["sql/install.sql"],
)
