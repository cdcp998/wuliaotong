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
    remark: str = ""
    items: list[RequisitionItemReq] = Field(min_length=1)


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
