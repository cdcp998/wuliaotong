"""领用出库 ORM 模型（对应《数据库设计.md》§2.6，2 张表）。

状态机：1 待审计 → 2 已通过 / 3 已驳回 / 4 已取消；已驳回可修改后重新提交（回 1）。
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.sys import TimestampMixin

REQ_STATUS_PENDING = 1  # 待审计
REQ_STATUS_APPROVED = 2  # 已通过
REQ_STATUS_REJECTED = 3  # 已驳回
REQ_STATUS_CANCELED = 4  # 已取消


class OutRequisition(TimestampMixin, Base):
    __tablename__ = "out_requisition"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    applicant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)  # 申请人（使用者）
    use_location: Mapped[str] = mapped_column(String(100), nullable=False)  # 使用地点（必填）
    use_reason: Mapped[str] = mapped_column(String(255), nullable=False)  # 因何使用（必填）
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=REQ_STATUS_PENDING)
    audit_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    audit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    audit_remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class OutRequisitionItem(Base):
    __tablename__ = "out_requisition_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    requisition_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    photo_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 出库商品照片（不强制）
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
