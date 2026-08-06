"""OCR 相关请求模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class DeliveryItem(BaseModel):
    product_name: str = Field(min_length=1, max_length=100)
    material_code: str = ""
    spec: str = ""
    unit: str = ""
    qty: str = "1"
    price: str = "0"
    amount: str = ""


class DeliveryConfirmReq(BaseModel):
    """送货单 OCR 人工确认：创建/匹配供应商并回写识别记录。"""

    record_id: int = 0
    supplier_name: str = ""
    bill_no: str = ""
    items: list[DeliveryItem] = Field(min_length=1)


class ClassifyReq(BaseModel):
    """材料分类识别请求：根据名称+规格用大模型判断系统分类。"""

    name: str = Field(min_length=1, max_length=100)
    spec: str = ""
