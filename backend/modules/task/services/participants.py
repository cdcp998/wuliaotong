"""task 模块公开服务：任务参与留痕（无锁协作制，人员留痕）。

设计说明：过程不锁人——任意维修人员可在任务池接力处理同一任务；每个关键动作
（领取处理/领用材料/完成）以 (task_type, task_id, user_id, action) 粒度留痕。
device 模块复用本服务（task_type='device'），跨模块不直接操作对方模型。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SysUser
from app.modules.task.models import TaskParticipant

# 动作枚举（展示名）
ACTION_LABELS: dict[str, str] = {
    "claim": "领取处理",
    "requisition": "领用材料",
    "complete": "处理完毕",
}

ACTION_CLAIM = "claim"
ACTION_REQUISITION = "requisition"
ACTION_COMPLETE = "complete"


def add_event(db: Session, task_type: str, task_id: int, user_id: int, action: str) -> bool:
    """记录一条参与留痕（幂等：同一人对同一任务的同一动作只记一次）。返回是否新增。"""
    if not user_id:
        return False
    exists = db.scalar(
        select(TaskParticipant.id).where(
            TaskParticipant.task_type == task_type,
            TaskParticipant.task_id == task_id,
            TaskParticipant.user_id == user_id,
            TaskParticipant.action == action,
        )
    )
    if exists:
        return False
    db.add(TaskParticipant(task_type=task_type, task_id=task_id, user_id=user_id, action=action, created_by=user_id))
    return True


def list_events(db: Session, task_type: str, task_ids: list[int]) -> dict[int, list[dict]]:
    """批量读取留痕明细：task_id → [{user_id, name, action, action_label, created_at}]（按时间升序）。"""
    ids = [int(i) for i in task_ids if i]
    if not ids:
        return {}
    rows = db.execute(
        select(TaskParticipant, SysUser.real_name)
        .join(SysUser, SysUser.id == TaskParticipant.user_id, isouter=True)
        .where(TaskParticipant.task_type == task_type, TaskParticipant.task_id.in_(ids))
        .order_by(TaskParticipant.id)
    ).all()
    out: dict[int, list[dict]] = {}
    for p, name in rows:
        out.setdefault(p.task_id, []).append({
            "user_id": p.user_id,
            "name": name or f"用户{p.user_id}",
            "action": p.action,
            "action_label": ACTION_LABELS.get(p.action, p.action),
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return out


def aggregate(events: list[dict]) -> list[dict]:
    """明细 → 聚合参与人（卡片/列表用）：[{user_id, name, actions:[label]}]，按首次参与排序。"""
    order: list[int] = []
    by_user: dict[int, dict] = {}
    for e in events:
        uid = e["user_id"]
        if uid not in by_user:
            order.append(uid)
            by_user[uid] = {"user_id": uid, "name": e["name"], "actions": []}
        label = e.get("action_label") or e["action"]
        if label not in by_user[uid]["actions"]:
            by_user[uid]["actions"].append(label)
    return [by_user[u] for u in order]


def participant_user_ids(db: Session, task_type: str, task_id: int) -> list[int]:
    """某任务的全部参与人 id（驳回退回通知用）。"""
    return list(db.scalars(
        select(TaskParticipant.user_id).where(
            TaskParticipant.task_type == task_type,
            TaskParticipant.task_id == task_id,
        ).distinct()
    ).all())


def attach(db: Session, items: list[dict], task_type: str) -> list[dict]:
    """为任务条目批量附加参与留痕：events（明细，上限 50 条/任务）+ participants（聚合）。

    条目需含 "id" 字段；task/device 模块通用（本表即跨模块共享基础设施）。
    """
    ids = [i.get("id") for i in items if i.get("id")]
    events_map = list_events(db, task_type, ids) if ids else {}
    for it in items:
        events = (events_map.get(it.get("id")) or [])[:50]
        it["events"] = events
        it["participants"] = aggregate(events)
    return items
