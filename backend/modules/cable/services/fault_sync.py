"""cable 模块公开服务：故障状态联动（task/device 模块经此调用）。

设计说明（方案 §开发规范补充 7「模块间禁止跨模块 import models；跨模块数据访问走 API 或共享
core 层」）：本文件是 cable 模块对外暴露的**服务接口**——其他模块只 import 本服务函数，
不 import cable 的 models，保持模块边界。

v1.1 状态流转（与 task_engine 任务态一一对应，形成统一联动视图）：
    0 待派发 →(任务派发)→ 1 已派发 →(接单)→ 2 进行中 →(完成)→ 3 完成待验
    →(验收)→ 4 已验证 →(关闭)→ 5 已关闭；驳回回到 2 进行中；取消/驳回重派回退。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.cable.models import CableFault

# fault.status 枚举（v2 任务池驱动，标签对齐任务态）：0 待处理 / 1 已派发(legacy)
# / 2 进行中 / 3 待审核 / 4 已完成(审核通过) / 5 已关闭
FAULT_PENDING, FAULT_DISPATCHED, FAULT_PROCESSING, FAULT_TO_VERIFY, FAULT_VERIFIED, FAULT_CLOSED = 0, 1, 2, 3, 4, 5

# 兼容别名（历史调用方语义：FAULT_FIXED ≡ 验收通过后的终验态）
FAULT_FIXED = FAULT_VERIFIED

# 状态 → 中文标签（前端同款映射；后端通知/提示词生成用）
FAULT_STATUS_LABELS: dict[int, str] = {
    FAULT_PENDING: "待处理",
    FAULT_DISPATCHED: "已派发",
    FAULT_PROCESSING: "进行中",
    FAULT_TO_VERIFY: "待审核",
    FAULT_VERIFIED: "已完成",
    FAULT_CLOSED: "已关闭",
}

# 活跃（未关闭）状态：地图层/附近故障展示用
FAULT_ACTIVE_STATUSES = (FAULT_PENDING, FAULT_DISPATCHED, FAULT_PROCESSING, FAULT_TO_VERIFY)


def set_fault_status(db: Session, fault_id: int | None, status: int) -> None:
    """更新故障状态（任务状态机联动用；fault_id 为空/不存在时静默跳过）。"""
    if not fault_id:
        return
    f = db.get(CableFault, fault_id)
    if f is not None:
        f.status = status


def fault_briefs(db: Session, fault_ids: list[int]) -> dict[int, dict]:
    """批量读取故障摘要（任务池/看板联动视图用）：id → {fault_type/status/severity/description}。

    跨模块安全：task/device 模块经本服务取故障信息，不直接 import CableFault。
    """
    ids = [int(i) for i in fault_ids if i]
    if not ids:
        return {}
    rows = db.scalars(select(CableFault).where(CableFault.id.in_(ids))).all()
    return {
        f.id: {
            "fault_id": f.id,
            "cable_id": f.cable_id,
            "fault_type": f.fault_type,
            "severity": f.severity,
            "status": f.status,
            "description": f.description,
        }
        for f in rows
    }
