"""task 模块 ORM（线缆和设备插件方案 §4.3，4 张表）。

表结构由模块自带 sql/install.sql 创建（幂等），卸载不删表不删数据；模型仅映射。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class MaintenanceTask(Base):
    __tablename__ = "maintenance_task"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_no: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    cable_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    fault_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    assignee_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scheduled_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verdict: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    cancel_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    cancelled_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    assigned_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class TaskRecord(Base):
    __tablename__ = "task_record"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    materials_used: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    knowledge_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class TaskRecordFile(Base):
    __tablename__ = "task_record_file"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    record_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    file_id: Mapped[int] = mapped_column(BigInteger, nullable=False)  # → sys_file.id
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="维修后")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class TaskRequisition(Base):
    __tablename__ = "task_requisition"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_type: Mapped[str] = mapped_column(String(10), nullable=False, default="cable")
    task_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    requisition_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
