"""task 模块（任务管理）：任务 CRUD/状态机/派发/维修记录/领用关联/统一任务池。

模块契约（方案 §2.2）：源码位于 backend/modules/task/，由 build_modules.py 部署到
backend/app/modules/task/。

依赖策略（v1.3 业务依赖）：
- 对 cable/device 无**硬**依赖声明（ModuleDef.dependencies=[]，安装不阻塞）；
- 但任务管理以「线缆管理 / 设备管理」为数据与操作入口——on_enable 钩子强制
  **至少一个业务模块已启用**（软「或」依赖：cable OR device，均未启用 → 拒绝启用 4002）；
- 关联故障/线缆的运行期操作仍经 _cable_guard 兜底 403；设备任务经任务池懒加载合并。

v1.2 统一任务池：GET /tasks/pool 合并线缆维修任务与设备维修任务，供看板/列表形成统一
联动视图。v1.2 起故障六态全程联动、已关闭自动归档、历史孤儿任务自动关联
（services/auto_link.py，on_enable 时执行 + POST /tasks/auto-link 手动补跑）。
"""
from __future__ import annotations

import logging

__version__ = "1.3.0"

from app.core.modules import ModuleDef, module_enabled
from app.modules.task.api import router

logger = logging.getLogger("app.task")


def _ensure_business_dep(db, module, ctx) -> None:
    """软「或」依赖门禁：cable / device 至少一个已启用（任务的数据与操作入口）。"""
    if not (module_enabled(db, "cable") or module_enabled(db, "device")):
        from app.core.response import BizError

        raise BizError(4002, "任务管理依赖「线缆管理」或「设备管理」至少一个模块启用（请先启用其一）")


def _auto_link_on_enable(db, module, ctx) -> None:
    """启用时执行一次历史未关联任务自动关联（异常隔离，不阻塞启用）。"""
    try:
        from app.modules.task.services.auto_link import auto_link_orphan_tasks

        linked = auto_link_orphan_tasks(db, notify=None)
        db.commit()
        if linked:
            logger.info("task 启用：历史未关联任务自动关联 %s 条", len(linked))
    except Exception:  # noqa: BLE001 自动关联失败不阻塞模块启用
        db.rollback()
        logger.warning("task 启用时自动关联失败（已跳过）", exc_info=True)


def _on_enable(db, module, ctx) -> None:
    """启用钩子：先过业务依赖门禁，再补跑历史任务自动关联。"""
    _ensure_business_dep(db, module, ctx)
    _auto_link_on_enable(db, module, ctx)


module = ModuleDef(
    code="task",
    name="任务管理",
    version=__version__,
    router=router,
    dependencies=[],
    on_enable=_on_enable,
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
        ("POST", "/tasks/auto-link"): "历史任务自动关联",
    },
    install_sql=["sql/install.sql"],
)
