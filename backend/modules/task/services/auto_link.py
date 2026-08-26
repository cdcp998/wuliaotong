"""历史未关联任务自动关联（需求 3「历史未关联任务自动关联」）。

场景：早期创建的线缆维修任务可能只挂了 cable_id（fault_id 为空）——当时故障尚未上报
或漏选。本服务在 task 模块启用时（及手动触发时）执行一次幂等补挂：

规则（确定性、可解释，避免误挂）：
- 仅处理**活动任务**且 fault_id 为空、cable_id 非空的孤儿任务；
- 候选故障：同一线缆、未软删除、状态非已关闭、且**尚未被任何任务关联**；
- 时间约束：故障上报时间 ≥ 任务创建时间（任务先建、故障后报 → 该故障正是待修目标；
  反向时序不做猜测性关联）；
- 每个孤儿任务至多挂一条（最早上报的候选）；挂接后通知任务创建人核实。

模块边界：经 fault_sync 服务/模型懒加载访问 cable 数据，task 未启用 cable 时自动跳过。
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.modules import module_enabled
from app.modules.task.models import MaintenanceTask

logger = logging.getLogger("app.task.auto_link")


def auto_link_orphan_tasks(db: Session, notify=None) -> list[dict]:
    """为历史孤儿任务自动关联故障，返回 [{task_id, task_no, fault_id}]。

    notify：可选回调 (db, user_id, title, content, link)，由调用方注入 _notify 以发站内通知。
    不 commit——事务边界由调用方控制（on_enable 钩子 / API 端点统一提交）。
    """
    if not module_enabled(db, "cable"):
        return []
    try:
        from app.modules.cable.models import CableFault
        from app.modules.cable.services.fault_sync import FAULT_CLOSED
    except ImportError:
        return []

    orphans = db.scalars(
        select(MaintenanceTask).where(
            MaintenanceTask.fault_id.is_(None),
            MaintenanceTask.cable_id.is_not(None),
            MaintenanceTask.status.notin_(("closed", "cancelled")),
        )
    ).all()
    linked: list[dict] = []
    for t in orphans:
        used_fault_ids = select(MaintenanceTask.fault_id).where(MaintenanceTask.fault_id.is_not(None))
        candidate = db.scalar(
            select(CableFault).where(
                CableFault.cable_id == t.cable_id,
                CableFault.deleted == 0,
                CableFault.status != FAULT_CLOSED,
                CableFault.id.not_in(used_fault_ids),
                CableFault.reported_at >= t.created_at,
            ).order_by(CableFault.reported_at, CableFault.id)
        )
        if candidate is None:
            continue
        t.fault_id = candidate.id
        linked.append({"task_id": t.id, "task_no": t.task_no, "fault_id": candidate.id})
        if notify is not None and t.created_by:
            notify(
                db, t.created_by, "任务已自动关联故障",
                f"任务 {t.task_no}「{t.title}」已自动关联同线缆故障 #{candidate.id}"
                f"（{candidate.fault_type or '未分类'}），请到任务列表核实。",
                "/task/list",
            )
    if linked:
        logger.info("历史未关联任务自动关联：%s 条（%s）", len(linked), [x["task_no"] for x in linked])
    return linked
