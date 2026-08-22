"""device 模块 Pydantic schemas。"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class DeviceCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    model: str = Field(default="", max_length=100)
    category: str = Field(default="", max_length=50)
    department_id: int = 0
    location: str = Field(default="", max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    status: int = 1
    purchase_date: date | None = None
    warranty_end: date | None = None
    remark: str = Field(default="", max_length=500)


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=50)
    department_id: int | None = None
    location: str | None = Field(default=None, max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    purchase_date: date | None = None
    warranty_end: date | None = None
    remark: str | None = Field(default=None, max_length=500)


class DeviceStatusReq(BaseModel):
    status: int = Field(ge=1, le=4)


class DeviceTaskCreate(BaseModel):
    device_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    priority: int = Field(default=1, ge=1, le=2)
    scheduled_time: datetime | None = None


class DeviceStatusReqT(BaseModel):
    action: str = Field(pattern="^(assign|accept|complete|verify|reject|close|cancel)$")
    assignee_id: int = 0
    verdict: str = Field(default="", max_length=500)
    reason: str = Field(default="", max_length=500)


class AssignReq(BaseModel):
    assignee_id: int = Field(gt=0)


class RecordFileIn(BaseModel):
    file_id: int = Field(gt=0)
    category: str = "维修后"
    remark: str = ""


class DeviceRecordCreate(BaseModel):
    content: str = Field(default="", max_length=5000)
    materials_used: list[dict[str, Any]] = Field(default_factory=list)
    knowledge_snapshot: dict[str, Any] | None = None
    files: list[RecordFileIn] = Field(default_factory=list)


class DeviceRequisitionReq(BaseModel):
    warehouse_id: int = Field(gt=0)
    use_location: str = Field(min_length=1, max_length=100)
    use_reason: str = Field(min_length=1, max_length=255)
    remark: str = Field(default="", max_length=200)
    items: list[dict[str, Any]] = Field(default_factory=list)


class DeviceFileIn(BaseModel):
    file_id: int = Field(gt=0)
    remark: str = Field(default="", max_length=255)
