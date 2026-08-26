"""map 模块 ORM（地图：图源配置/瓦片缓存区域/下载任务）。

表结构由模块自带 sql/install.sql 创建（CREATE TABLE IF NOT EXISTS 幂等），
卸载不删表不删数据；模型仅映射。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


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
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0未开始/1下载中/2完成/3暂停/4任务生成中
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class MapDownloadTask(Base):
    __tablename__ = "map_download_task"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    region_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="")  # 地图源 key（migration 0001）
    z: Mapped[int] = mapped_column(Integer, nullable=False)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0待下载/1成功/2失败/3跳过
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
