"""task 模块 Pydantic schemas。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    cable_id: int | None = None
    fault_id: int | None = None
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    priority: int = Field(default=1, ge=1, le=2)
    scheduled_time: datetime | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    priority: int | None = Field(default=None, ge=1, le=2)
    scheduled_time: datetime | None = None


class AssignReq(BaseModel):
    assignee_id: int = Field(gt=0)


class StatusReq(BaseModel):
    action: str = Field(pattern="^(assign|accept|complete|verify|reject|close|cancel)$")
    assignee_id: int = 0
    verdict: str = Field(default="", max_length=500)
    reason: str = Field(default="", max_length=500)


class RecordFileIn(BaseModel):
    file_id: int = Field(gt=0)
    category: str = "维修后"
    remark: str = ""


class RecordCreate(BaseModel):
    content: str = Field(default="", max_length=5000)
    materials_used: list[dict[str, Any]] = Field(default_factory=list)
    knowledge_snapshot: dict[str, Any] | None = None
    files: list[RecordFileIn] = Field(default_factory=list)


class TaskRequisitionReq(BaseModel):
    """任务领用（复用领用体系：同事务创建 out_requisition + 任务链接）。"""

    warehouse_id: int = Field(gt=0)
    use_location: str = Field(min_length=1, max_length=100)
    use_reason: str = Field(min_length=1, max_length=255)
    remark: str = Field(default="", max_length=200)
    items: list[dict[str, Any]] = Field(default_factory=list)  # {product_id, qty, location_id, photo_file_id}
