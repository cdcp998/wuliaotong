"""库存/采购/期初 ORM 模型（对应《数据库设计.md》§2.4-2.5，6 张表）。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.sys import TimestampMixin


class PchPurchasePlan(TimestampMixin, Base):
    """采购计划单（事物流前置环节）：到货后按计划生成材料入库，计划状态自动推进。

    status：0 草稿 / 1 已提交 / 2 部分入库 / 3 已完成 / -1 作废。
    计划本身不动库存；只有由它生成的入库单才走 post_stock_change 落账。
    """

    __tablename__ = "pch_purchase_plan"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    supplier_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    plan_date: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default="CURRENT_TIMESTAMP"
    )
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    creator_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class PchPurchasePlanItem(Base):
    """采购计划明细：计划数量（到货实际数量在入库单上按实收填，计划可分批多次入库）。"""

    __tablename__ = "pch_purchase_plan_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    planned_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_name: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    est_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class StkStock(Base):
    """实时库存（无 created_at，仅 updated_at；一切变动必须走 services/stock.py）。"""

    __tablename__ = "stk_stock"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    cost_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default="CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    )


class StkStockLog(Base):
    """库存流水：一切库存变动的唯一事实来源。"""

    __tablename__ = "stk_stock_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), nullable=False)
    bill_type: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    bill_item_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    before_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    change_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    after_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    cost_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    photo_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    operator_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default="CURRENT_TIMESTAMP"
    )


class StkOpening(TimestampMixin, Base):
    __tablename__ = "stk_opening"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0 草稿 / 1 已过账
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    creator_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class StkOpeningItem(Base):
    __tablename__ = "stk_opening_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    cost_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)


class PchPurchaseIn(TimestampMixin, Base):
    __tablename__ = "pch_purchase_in"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    supplier_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1 已入库 / 0 草稿 / -1 作废
    bill_date: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default="CURRENT_TIMESTAMP"
    )
    operator_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    ocr_record_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 来源送货单 OCR 记录 → ocr_record.id（0=手工录入）
    ocr_bill_no: Mapped[str] = mapped_column(String(60), nullable=False, default="")  # 送货单号（OCR 识别/手工填写，可空）
    plan_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 来源采购计划单 → pch_purchase_plan.id（0=无计划）
    delivery_file_ids: Mapped[str] = mapped_column(Text, nullable=False, default="")  # 送货单图片存底：JSON 数组 [file_id,...]，最多 10 张
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class PchPurchaseInItem(Base):
    __tablename__ = "pch_purchase_in_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_name: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    photo_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
