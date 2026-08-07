"""领用出库 ORM 模型（对应《数据库设计.md》§2.6，2 张表）。

状态机：1 待完成工作（申请已提交、已出库）→ 完成工作拍照 → 2 待审计 →
审计通过 3 已完成 / 驳回 4 已驳回（可修改重提，回 1）；5 已取消。
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.sys import TimestampMixin

REQ_STATUS_WORKING = 1  # 待完成工作（申请已提交、已自动出库）
REQ_STATUS_PENDING = 2  # 待审计（已完成工作并拍照留痕）
REQ_STATUS_APPROVED = 3  # 已完成（审计通过）
REQ_STATUS_REJECTED = 4  # 已驳回（可修改重提，回 1）
REQ_STATUS_CANCELED = 5  # 已取消


class OutRequisition(TimestampMixin, Base):
    __tablename__ = "out_requisition"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    applicant_id: Mapped[int] = mapped_column(BigInteger, nullable=False)  # 申请人（使用者）
    use_location: Mapped[str] = mapped_column(String(100), nullable=False)  # 使用地点（必填）
    use_reason: Mapped[str] = mapped_column(String(255), nullable=False)  # 因何使用（必填）
    is_private: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 私用标记（隐藏触发，仅管理员可见）
    display_location: Mapped[str] = mapped_column(String(100), nullable=False, default="")  # 对外掩护“使用地点”（固定，管理员可改）
    display_reason: Mapped[str] = mapped_column(String(255), nullable=False, default="")  # 对外掩护“因何使用”（固定，管理员可改）
    location_photo_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 使用地点照片（不强制）
    work_photo_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 完成工作照片（工作地点拍照留痕）
    work_done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # 完成工作时间
    work_lat: Mapped[str] = mapped_column(String(30), nullable=False, default="")  # 完成工作定位纬度
    work_lng: Mapped[str] = mapped_column(String(30), nullable=False, default="")  # 完成工作定位经度
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
