"""领用申请请求/响应模型（金额/数量按字符串传输）。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_serializer, field_validator

_DECIMAL_RE = r"^\d+(\.\d+)?$"


class RequisitionItemReq(BaseModel):
    product_id: int = Field(gt=0)
    qty: str
    location_id: int = Field(gt=0)
    photo_file_id: int = 0

    @field_validator("qty")
    @classmethod
    def _dec(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("数量必须是数字")
        return v


class RequisitionReq(BaseModel):
    warehouse_id: int = Field(gt=0)
    use_location: str = Field(min_length=1, max_length=100, description="使用地点（必填）")
    use_reason: str = Field(min_length=1, max_length=255, description="因何使用（必填）")
    is_private: int = Field(default=0, ge=0, le=1, description="私用标记（隐藏触发，提交时因何使用将被锁定为「私用」）")
    applicant_id: int = Field(default=0, ge=0, description="指定申请人（仅管理员可代申请；0=自己）")
    location_photo_file_id: int = 0  # 使用地点照片（不强制）
    remark: str = ""
    items: list[RequisitionItemReq] = Field(min_length=1)


class WorkDoneReq(BaseModel):
    photo_file_id: int = Field(gt=0, description="完成工作照片（工作地点拍照留痕）")
    lat: str = Field(default="", max_length=30, description="手机定位纬度（水印用）")
    lng: str = Field(default="", max_length=30, description="手机定位经度（水印用）")


class WorkLocationReq(BaseModel):
    use_location: str = Field(min_length=1, max_length=100, description="使用地点（水印/记录用）")
    lat: str = Field(default="", max_length=30, description="GPS 纬度")
    lng: str = Field(default="", max_length=30, description="GPS 经度")


class DisplayReq(BaseModel):
    display_reason: str = Field(min_length=1, max_length=255, description="对外掩护-因何使用")
    display_location: str = Field(min_length=1, max_length=100, description="对外掩护-使用地点")


class AuditReq(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    remark: str = Field(default="", max_length=255)


class RequisitionItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    code: str = ""
    spec: str = ""
    location_id: int
    location_code: str = ""
    qty: Decimal
    photo_file_id: int

    @field_serializer("qty")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class RequisitionOut(BaseModel):
    id: int
    bill_no: str
    applicant_id: int
    applicant_name: str = ""
    use_location: str
    use_reason: str
    is_private: int = 0  # 仅管理员可见真实标记；非管理员恒为 0
    display_reason: str = ""  # 仅管理员返回（掩护值，可编辑）；非管理员恒为空
    display_location: str = ""
    location_photo_file_id: int
    work_photo_file_id: int = 0  # 完成工作照片（工作地点拍照留痕）
    work_done_at: datetime | None = None  # 完成工作时间
    work_lat: str = ""  # 完成工作定位纬度
    work_lng: str = ""  # 完成工作定位经度
    warehouse_id: int
    warehouse_name: str = ""
    total_qty: Decimal
    status: int
    audit_by: int
    audit_name: str = ""
    audit_time: datetime | None
    audit_remark: str
    remark: str
    created_at: datetime
    items: list[RequisitionItemOut] = []

    @field_serializer("total_qty")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class PageData(BaseModel):
    list: list[Any]
    total: int
    page: int
    page_size: int
