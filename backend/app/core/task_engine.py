"""通用任务状态机核心（线缆和设备插件方案 §5.12 / §13.2）。

- 不建表、不 commit：纯服务，状态校验 + 字段落库；事务边界由调用方控制（须与审计/联动同事务）。
- 回调钩子 transition_callbacks：device 等模块注入设备状态联动（callback(db, task, action, actor, **kwargs)）。
- 状态机：pending →(assign)→ assigned →(accept)→ in_progress →(complete)→ done →(verify)→ verified →(close)→ closed
          done →(reject)→ in_progress；pending/assigned →(cancel)→ cancelled
- 唯一活跃任务约束：同一 fault 最多一个非终态任务（创建时应用层校验，见 task 模块）。

术语：task 为任意实现 __tablename__ 且有 status/task_no 字段的 ORM 对象（cable 任务 / 设备任务复用）。
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.response import BizError, E_BILL_STATUS

# 状态流转表：当前状态 → 允许动作 → 目标状态
STATUS_FLOW: dict[str, dict[str, str]] = {
    "pending": {"assign": "assigned", "cancel": "cancelled"},
    "assigned": {"accept": "in_progress", "cancel": "cancelled"},
    "in_progress": {"complete": "done"},
    "done": {"verify": "verified", "reject": "in_progress"},
    "verified": {"close": "closed"},
}

# 终态：不再接受任何流转
TERMINAL_STATUS = ("closed", "cancelled")

# 非终态（唯一活跃约束用）：pending/assigned/in_progress/done
ACTIVE_STATUSES = ("pending", "assigned", "in_progress", "done")

ACTION_LABEL = {
    "assign": "派发", "accept": "接单", "complete": "完成",
    "verify": "验收", "reject": "驳回", "close": "关闭", "cancel": "取消",
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
    - assign: assignee_id（必填）
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
    if action == "assign":
        assignee_id = kwargs.get("assignee_id") or 0
        if not assignee_id:
            raise BizError(E_BILL_STATUS, "派发必须指定维修人员")
        task.assignee_id = assignee_id
        task.assigned_by = actor_id
        task.cancel_reason = ""
    elif action == "accept":
        if kwargs.get("assignee_id") and kwargs["assignee_id"] != actor_id:
            raise BizError(E_BILL_STATUS, "仅被指派人员可接单")
    elif action == "complete":
        task.completed_at = now
    elif action in ("verify", "reject"):
        verdict = (kwargs.get("verdict") or "").strip()
        if not verdict:
            raise BizError(E_BILL_STATUS, f"{'验收' if action == 'verify' else '驳回'}必须填写结论")
        task.verdict = verdict
    elif action == "cancel":
        reason = (kwargs.get("reason") or "").strip()
        if not reason:
            raise BizError(E_BILL_STATUS, "取消必须填写原因")
        task.cancel_reason = reason
        task.cancelled_by = actor_id
        task.cancelled_at = now

    task.status = target
    # 回调（设备状态联动等）：与主流转同事务，异常冒泡由调用方处理
    for cb in callbacks or []:
        cb(db, task, action, actor_id, actor_name)
    return task
