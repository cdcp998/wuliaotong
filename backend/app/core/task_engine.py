"""通用任务状态机核心（线缆和设备插件方案 §5.12 / §13.2；v2 任务池无锁协作制）。

- 不建表、不 commit：纯服务，状态校验 + 字段落库；事务边界由调用方控制（须与审计/联动同事务）。
- 回调钩子 transition_callbacks：device 等模块注入设备状态联动（callback(db, task, action, actor, **kwargs)）。
- 状态机（无锁协作：过程不锁人，人员留痕；任意维修人员可接力处理同一任务）：
          pending →(claim)→ in_progress →(complete)→ done →(verify)→ closed（审核即归档）
          done →(reject)→ in_progress（驳回带理由，退回参与者重做）；pending →(cancel)→ cancelled
- claim 仅作「开始处理」留痕与主责标记（首位领取人为 assignee_id），不排斥他人接续操作；
  人员留痕由 task 模块 task_participant 表记录（谁领料/谁处理/谁完成）。
- 唯一活跃任务约束：同一 fault 最多一个非终态任务（创建时应用层校验，见 task 模块）。

术语：task 为任意实现 __tablename__ 且有 status/task_no 字段的 ORM 对象（cable 任务 / 设备任务复用）。
历史兼容：legacy 'assigned'/'verified' 不再产生（存量数据已迁移）；展示名保留。
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.response import BizError, E_BILL_STATUS

# 状态流转表：当前状态 → 允许动作 → 目标状态（无锁协作制）
STATUS_FLOW: dict[str, dict[str, str]] = {
    "pending": {"claim": "in_progress", "cancel": "cancelled"},
    # legacy 'assigned' 仅存在于迁移前数据；保留修正通道
    "assigned": {"claim": "in_progress", "cancel": "cancelled"},
    "in_progress": {"complete": "done"},
    "done": {"verify": "closed", "reject": "in_progress"},
    # legacy 'verified'：历史数据兼容通道（新流程审核即归档）
    "verified": {"close": "closed"},
}

# 终态：不再接受任何流转
TERMINAL_STATUS = ("closed", "cancelled")

# 非终态（唯一活跃约束用）
ACTIVE_STATUSES = ("pending", "assigned", "in_progress", "done")

# 已废弃的历史状态（不再产生新数据）
LEGACY_STATUSES = ("assigned", "verified")

ACTION_LABEL = {
    "claim": "领取处理", "complete": "完成",
    "verify": "审核通过（归档）", "reject": "驳回", "close": "关闭", "cancel": "取消",
    "assign": "派发（已废弃）", "accept": "接单（已废弃）",
}


def allowed_actions(status: str) -> list[str]:
    return list(STATUS_FLOW.get(status, {}).keys())


def transition(
    db: Session,
    task,
    action: str,
    actor_id: int,
    actor_name: str = "",
    callbacks: list[Callable] | None = None,
    **kwargs,
):
    """执行一次状态流转（不 commit）。

    kwargs：
    - claim: （无需参数；负责人=actor，由调用方在 callbacks 前后按需读取 task.assignee_id）
    - verify/reject: verdict（必填）
    - cancel: reason（必填）
    - 其余动作可透传自定义字段（写入由调用方在 callbacks 中处理）
    """
    target = STATUS_FLOW.get(getattr(task, "status", "") or "", {}).get(action)
    if target is None:
        current = getattr(task, "status", "?")
        raise BizError(
            E_BILL_STATUS,
            f"当前状态「{current}」不允许执行「{ACTION_LABEL.get(action, action)}」（可执行: "
            + "/".join(ACTION_LABEL.get(a, a) for a in allowed_actions(current))
            + "）",
        )

    # ---- 动作参数校验与通用字段落库 ----
    now = datetime.now()
    if action == "claim":
        # 无锁协作：领取仅标记「开始处理」；主责（assignee_id）留首位领取人，不排斥他人接续
        if not getattr(task, "assignee_id", 0):
            task.assignee_id = actor_id
        task.cancel_reason = ""
    elif action == "complete":
        task.completed_at = now
    elif action in ("verify", "reject"):
        verdict = (kwargs.get("verdict") or "").strip()
        if not verdict:
            raise BizError(E_BILL_STATUS, f"{'审核' if action == 'verify' else '驳回'}必须填写结论")
        task.verdict = verdict
    elif action == "cancel":
        reason = (kwargs.get("reason") or "").strip()
        if not reason:
            raise BizError(E_BILL_STATUS, "取消必须填写原因")
        task.cancel_reason = reason
        task.cancelled_by = actor_id
        task.cancelled_at = now

    task.status = target
    # 回调（故障/设备状态联动等）：与主流转同事务，异常冒泡由调用方处理
    for cb in callbacks or []:
        cb(db, task, action, actor_id, actor_name)
    return task
