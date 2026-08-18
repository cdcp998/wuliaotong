"""基础资料请求/响应模型。金额/数量按《后端API设计.md》约定以字符串传输。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_serializer, field_validator

_DECIMAL_RE = r"^\d+(\.\d+)?$"


def _dec_str(v: Decimal) -> str:
    return format(v, "f")


class UnitReq(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    remark: str = ""


class UnitOut(BaseModel):
    id: int
    name: str
    remark: str


class CategoryReq(BaseModel):
    parent_id: int = 0
    name: str = Field(min_length=1, max_length=50)
    sort: int = 0


class CategoryNode(BaseModel):
    id: int
    parent_id: int
    name: str
    sort: int
    children: list["CategoryNode"] = []


class SupplierReq(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=100)
    contact: str = ""
    phone: str = ""
    address: str = ""
    remark: str = ""
    status: int = 1


class SupplierOut(BaseModel):
    id: int
    code: str
    name: str
    contact: str
    phone: str
    address: str
    remark: str
    status: int


class ProductUnitItem(BaseModel):
    unit_id: int
    rate: str = "1"
    is_default: int = 0

    @field_validator("rate")
    @classmethod
    def _rate(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("rate 必须是数字")
        return v


class ProductReq(BaseModel):
    code: str = Field(default="", max_length=50, description="商品编码（纯数字，留空自动生成）")
    material_code: str = Field(default="", max_length=50, description="物料编码（公司系统编码，空则提示管理员补录）")
    barcode: str = ""
    sku: str = ""
    name: str = Field(min_length=1, max_length=100)
    category_id: int = 0
    spec: str = ""
    unit_id: int = Field(gt=0)
    purchase_price: str = "0"
    min_stock: str = "0"
    max_stock: str = "0"
    image_file_id: int = 0
    status: int = 1
    remark: str = ""
    units: list[ProductUnitItem] = []
    supplier_ids: list[int] | None = None  # None=不修改关联（编辑时缺省保持），[]=清空关联

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip()
        if v and not v.isdigit():
            raise ValueError("商品编码必须是纯数字（留空自动生成）")
        return v

    @field_validator("purchase_price", "min_stock", "max_stock")
    @classmethod
    def _dec(cls, v: str) -> str:
        if not __import__("re").fullmatch(_DECIMAL_RE, v):
            raise ValueError("金额/数量必须是数字")
        return v


class ProductCategoryReq(BaseModel):
    """单独更新材料分类（分类管理页「取消挂载/改挂」用）：0 = 取消挂载（未分类）。"""

    category_id: int = 0


class ProductOut(BaseModel):
    id: int
    code: str
    material_code: str
    barcode: str
    sku: str
    name: str
    category_id: int
    category_name: str = ""
    spec: str
    unit_id: int
    unit_name: str = ""
    purchase_price: Decimal
    min_stock: Decimal
    max_stock: Decimal
    status: int
    remark: str
    created_at: datetime | None = None
    units: list[dict[str, Any]] = []
    supplier_ids: list[int] = []
    supplier_names: list[str] = []

    @field_serializer("purchase_price", "min_stock", "max_stock")
    def _ser_dec(self, v: Decimal) -> str:
        return _dec_str(v)


class WarehouseReq(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=100)
    address: str = ""
    manager_id: int = 0
    remark: str = ""


class WarehouseUpdateReq(BaseModel):
    """编辑仓库：编码不允许修改（界面不展示编码），名称/地址/备注可更新。"""
    name: str = Field(min_length=1, max_length=100)
    address: str = ""
    remark: str = ""


class WarehouseOut(BaseModel):
    id: int
    code: str
    name: str
    address: str
    remark: str
    status: int


class ShelfReq(BaseModel):
    warehouse_id: int = Field(gt=0)
    code: str = Field(min_length=1, max_length=30)
    name: str = ""
    remark: str = ""


class ShelfOut(BaseModel):
    id: int
    warehouse_id: int
    code: str
    name: str
    remark: str


class LocationReq(BaseModel):
    warehouse_id: int = Field(gt=0)
    shelf_id: int = Field(gt=0)
    layer_no: int = Field(ge=1, le=99)
    code: str = ""  # 留空由服务端自动生成：仓库编码-货架编码-层号
    remark: str = ""


class LocationOut(BaseModel):
    id: int
    warehouse_id: int
    shelf_id: int
    layer_no: int
    code: str
    display: str = ""  # 友好库位名：仓库名-货架编码-层号（界面显示用，避免 WH 编码混淆）
    remark: str


class PageData(BaseModel):
    list: list[Any]
    total: int
    page: int
    page_size: int
