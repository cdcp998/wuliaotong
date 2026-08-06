"""库存进阶 ORM 模型（对应《数据库设计.md》§2.7-2.9，6 张表）：其他出入库/调拨/盘点。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.sys import TimestampMixin


class StkOtherIo(TimestampMixin, Base):
    __tablename__ = "stk_other_io"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    io_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 报废/报损/赠品入/赠品出/其他入/其他出
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1 已过账 / 0 草稿 / -1 作废
    operator_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class StkOtherIoItem(Base):
    __tablename__ = "stk_other_io_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    photo_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class StkTransfer(TimestampMixin, Base):
    __tablename__ = "stk_transfer"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    from_warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    to_warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 1 已审核 / 0 草稿 / -1 作废
    audit_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    audit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class StkTransferItem(Base):
    __tablename__ = "stk_transfer_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    transfer_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    from_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    to_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class StkCheck(TimestampMixin, Base):
    __tablename__ = "stk_check"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bill_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0 草稿 / 1 盘点中 / 2 已审核
    checker_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    check_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class StkCheckItem(Base):
    __tablename__ = "stk_check_item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    check_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    book_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    real_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    diff_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    photo_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)  # 盘点拍照记录（可选）
