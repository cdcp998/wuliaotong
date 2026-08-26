"""cable 模块 ORM（线缆/标记点/故障；地图部分见 map 模块）。

表结构由模块自带 sql/install.sql 创建（CREATE TABLE IF NOT EXISTS 幂等），
卸载不删表不删数据；模型仅映射。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Cable(Base):
    __tablename__ = "cable"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="wire")  # wire/fiber/network
    total_length: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    geometry: Mapped[str | None] = mapped_column(Text, nullable=True)  # GeoJSON LineString
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1在用 0停用 2归档
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class CablePoint(Base):
    __tablename__ = "cable_point"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    cable_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lat: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    cumulative_distance: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    label: Mapped[str] = mapped_column(String(100), nullable=False, default="")


class CableMarker(Base):
    __tablename__ = "cable_marker"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    cable_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    lat: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    cumulative_distance: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    marker_type: Mapped[str] = mapped_column(String(30), nullable=False, default="")  # 接头/转角/其他
    label: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class CableFault(Base):
    __tablename__ = "cable_fault"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    cable_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    lat: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    cumulative_distance: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    fault_type: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    severity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1低/2中/3高
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0待派发/1已派发/2进行中/3完成待验/4已验证/5已关闭（v1.1 与任务态联动）
    deleted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 软删除：1=已删除（错误标点，migration 0002）
    reported_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    reported_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    photos_note: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FaultFile(Base):
    __tablename__ = "fault_file"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fault_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    file_id: Mapped[int] = mapped_column(BigInteger, nullable=False)  # → sys_file.id
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="")  # 故障位置/现场/维修后
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    remark: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
