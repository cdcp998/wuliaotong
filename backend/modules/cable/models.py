"""cable 模块 ORM（线缆和设备插件方案 §4.2，7 张表）。

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
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0待处理/1处理中/2待验证/3已修复/4已关闭
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


class MapCacheRegion(Base):
    __tablename__ = "map_cache_region"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    geometry: Mapped[str | None] = mapped_column(Text, nullable=True)  # GeoJSON Polygon
    min_zoom: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_zoom: Mapped[int] = mapped_column(Integer, nullable=False, default=18)
    tile_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_download_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    update_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")  # daily/weekly/manual
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0未开始/1下载中/2完成/3暂停
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class MapDownloadTask(Base):
    __tablename__ = "map_download_task"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    region_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    z: Mapped[int] = mapped_column(Integer, nullable=False)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0待下载/1成功/2失败/3跳过
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
