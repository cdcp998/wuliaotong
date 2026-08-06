"""库存进阶请求/响应模型（数量按字符串传输）。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_serializer, field_validator

_DECIMAL_RE = r"^\d+(\.\d+)?$"

OTHER_IO_TYPES = ("报废", "报损", "赠品入", "赠品出", "其他入", "其他出")
IN_TYPES = ("赠品入", "其他入")  # 正方向
OUT_TYPES = ("报废", "报损", "赠品出", "其他出")  # 负方向


class TransferItemReq(BaseModel):
    product_id: int = Field(gt=0)
    qty: str
    from_location_id: int = Field(gt=0)
    to_location_id: int = Field(gt=0)

    @field_validator("qty")
    @classmethod
    def _dec(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("数量必须是数字")
        return v


class TransferReq(BaseModel):
    from_warehouse_id: int = Field(gt=0)
    to_warehouse_id: int = Field(gt=0)
    remark: str = ""
    items: list[TransferItemReq] = Field(min_length=1)


class OtherIoItemReq(BaseModel):
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


class OtherIoReq(BaseModel):
    io_type: str
    warehouse_id: int = Field(gt=0)
    remark: str = ""
    items: list[OtherIoItemReq] = Field(min_length=1)

    @field_validator("io_type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v not in OTHER_IO_TYPES:
            raise ValueError(f"io_type 必须是 {'/'.join(OTHER_IO_TYPES)}")
        return v


class CheckItemReq(BaseModel):
    check_item_id: int = Field(gt=0)
    real_qty: str
    photo_file_id: int = 0  # 盘点拍照记录（可选）

    @field_validator("real_qty")
    @classmethod
    def _dec(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("实盘数量必须是数字")
        return v


class CheckItemsReq(BaseModel):
    items: list[CheckItemReq] = Field(min_length=1)


class CheckReq(BaseModel):
    warehouse_id: int = Field(gt=0)
    remark: str = ""


class _ItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    code: str = ""
    location_id: int
    location_code: str = ""
    qty: Decimal

    @field_serializer("qty")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class TransferOut(BaseModel):
    id: int
    bill_no: str
    from_warehouse_id: int
    from_warehouse_name: str = ""
    to_warehouse_id: int
    to_warehouse_name: str = ""
    status: int
    audit_name: str = ""
    audit_time: datetime | None
    remark: str
    items: list[_ItemOut] = []


class OtherIoOut(BaseModel):
    id: int
    bill_no: str
    warehouse_id: int
    warehouse_name: str = ""
    io_type: str
    status: int
    operator_name: str = ""
    remark: str
    items: list[_ItemOut] = []


class CheckItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    code: str = ""
    location_id: int
    location_code: str = ""
    book_qty: Decimal
    real_qty: Decimal | None
    diff_qty: Decimal
    photo_file_id: int = 0  # 盘点拍照记录（可选）

    @field_serializer("book_qty", "real_qty", "diff_qty")
    def _ser(self, v: Decimal | None) -> str | None:
        return format(v, "f") if v is not None else None


class CheckOut(BaseModel):
    id: int
    bill_no: str
    warehouse_id: int
    warehouse_name: str = ""
    status: int
    checker_name: str = ""
    check_date: datetime
    remark: str
    items: list[CheckItemOut] = []


class PageData(BaseModel):
    list: list[Any]
    total: int
    page: int
    page_size: int
