"""库存模块请求/响应模型（金额/数量按字符串传输）。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_serializer, field_validator

_DECIMAL_RE = r"^\d+(\.\d+)?$"


class PurchaseInItemReq(BaseModel):
    product_id: int = Field(gt=0)
    qty: str
    unit_name: str = ""
    price: str = "0"
    location_id: int = Field(gt=0)
    photo_file_id: int = 0
    category_id: int = 0  # 大模型识别/人工确认的材料分类（>0 时入库同时更新材料分类）

    @field_validator("qty", "price")
    @classmethod
    def _dec(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("数量/金额必须是数字")
        return v


class PurchaseInReq(BaseModel):
    supplier_id: int = 0
    warehouse_id: int = Field(gt=0)
    bill_date: datetime | None = None
    remark: str = Field(default="", max_length=200)
    ocr_record_id: int = 0  # 来源送货单 OCR 识别记录（0=手工录入）
    ocr_bill_no: str = Field(default="", max_length=60)  # 送货单号（OCR 识别带入/手工填写，可空）
    plan_id: int = 0  # 来源采购计划单（0=无计划，手工入库）
    delivery_file_ids: list[int] = []  # 送货单图片存底（可选，最多 10 张）
    items: list[PurchaseInItemReq] = Field(min_length=1)


class PurchaseInItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    code: str = ""
    qty: Decimal
    unit_name: str
    price: Decimal
    amount: Decimal
    location_id: int
    location_code: str = ""

    @field_serializer("qty", "price", "amount")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class PurchaseInOut(BaseModel):
    id: int
    bill_no: str
    ocr_bill_no: str = ""  # 送货单号（来源单据）
    supplier_id: int
    supplier_name: str = ""
    warehouse_id: int
    warehouse_name: str = ""
    total_qty: Decimal
    total_amount: Decimal
    status: int
    bill_date: datetime
    operator_name: str = ""
    ocr_record_id: int = 0
    plan_id: int = 0  # 来源采购计划单
    plan_bill_no: str = ""  # 采购计划单号（来源单据）
    delivery_file_ids: list[int] = []  # 送货单图片存底
    remark: str
    items: list[PurchaseInItemOut] = []

    @field_serializer("total_qty", "total_amount")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


# ============================ 采购计划单 ============================


class PurchasePlanItemReq(BaseModel):
    product_id: int = Field(gt=0)
    planned_qty: str
    unit_name: str = ""
    est_price: str = "0"  # 预计单价（可空/0，仅估金额，不影响入库实际价格）
    remark: str = Field(default="", max_length=200)

    @field_validator("planned_qty", "est_price")
    @classmethod
    def _dec(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("数量/金额必须是数字")
        return v


class PurchasePlanReq(BaseModel):
    supplier_id: int = 0
    warehouse_id: int = Field(gt=0)
    plan_date: datetime | None = None
    remark: str = Field(default="", max_length=255)
    items: list[PurchasePlanItemReq] = Field(min_length=1)


class PurchasePlanItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    code: str = ""
    planned_qty: Decimal
    unit_name: str
    est_price: Decimal
    amount: Decimal
    remark: str = ""
    received_qty: Decimal = 0  # 已累计入库数量（按 plan 关联的入库单统计）

    @field_serializer("planned_qty", "est_price", "amount", "received_qty")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class PurchasePlanOut(BaseModel):
    id: int
    bill_no: str
    supplier_id: int
    supplier_name: str = ""
    warehouse_id: int
    warehouse_name: str = ""
    status: int  # 0 草稿 / 1 已提交 / 2 部分入库 / 3 已完成 / -1 作废
    total_qty: Decimal
    total_amount: Decimal
    plan_date: datetime
    remark: str
    creator_name: str = ""
    items: list[PurchasePlanItemOut] = []

    @field_serializer("total_qty", "total_amount")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class OpeningItemReq(BaseModel):
    product_id: int = Field(gt=0)
    location_id: int = Field(gt=0)
    qty: str
    cost_price: str = "0"

    @field_validator("qty", "cost_price")
    @classmethod
    def _dec(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("数量/金额必须是数字")
        return v


class OpeningReq(BaseModel):
    warehouse_id: int = Field(gt=0)
    remark: str = Field(default="", max_length=200)
    items: list[OpeningItemReq] = Field(min_length=1)


class OpeningItemOut(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    code: str = ""
    location_id: int
    location_code: str = ""
    qty: Decimal
    cost_price: Decimal

    @field_serializer("qty", "cost_price")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class OpeningOut(BaseModel):
    id: int
    bill_no: str
    warehouse_id: int
    warehouse_name: str = ""
    status: int
    remark: str
    creator_name: str = ""
    items: list[OpeningItemOut] = []


class StockRow(BaseModel):
    product_id: int
    product_name: str = ""
    code: str = ""
    material_code: str = ""
    barcode: str = ""
    spec: str = ""
    warehouse_id: int
    warehouse_name: str = ""
    location_id: int
    location_code: str = ""
    qty: Decimal
    cost_price: Decimal
    amount: Decimal

    @field_serializer("qty", "cost_price", "amount")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class StockFlowRow(BaseModel):
    id: int
    product_id: int
    product_name: str = ""
    code: str = ""
    warehouse_name: str = ""
    location_code: str = ""
    change_type: str
    bill_no: str
    before_qty: Decimal
    change_qty: Decimal
    after_qty: Decimal
    cost_price: Decimal
    operator_name: str = ""
    remark: str
    created_at: datetime

    @field_serializer("before_qty", "change_qty", "after_qty", "cost_price")
    def _ser(self, v: Decimal) -> str:
        return format(v, "f")


class PageData(BaseModel):
    list: list[Any]
    total: int
    page: int
    page_size: int
