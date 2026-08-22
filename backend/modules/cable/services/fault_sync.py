"""cable 模块公开服务：故障状态联动（task/device 模块经此调用）。

设计说明（方案 §开发规范补充 7「模块间禁止跨模块 import models；跨模块数据访问走 API 或共享
core 层」）：本文件是 cable 模块对外暴露的**服务接口**——其他模块只 import 本服务函数，
不 import cable 的 models，保持模块边界。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.cable.models import CableFault

# fault.status 枚举：0 待处理 / 1 处理中 / 2 待验证 / 3 已修复 / 4 已关闭
FAULT_PENDING, FAULT_PROCESSING, FAULT_TO_VERIFY, FAULT_FIXED, FAULT_CLOSED = 0, 1, 2, 3, 4


def set_fault_status(db: Session, fault_id: int | None, status: int) -> None:
    """更新故障状态（任务状态机联动用；fault_id 为空/不存在时静默跳过）。"""
    if not fault_id:
        return
    f = db.get(CableFault, fault_id)
    if f is not None:
        f.status = status
