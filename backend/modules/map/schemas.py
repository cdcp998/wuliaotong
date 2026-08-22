"""map 模块请求模型（地图源配置 / 缓存区域）。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class MapSourceIn(BaseModel):
    """地图源配置（api_secret 加密后入库，永不下发前端）。"""

    key: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    type: str = "xyz"  # esri/mapbox/google/amap/baidu/tms/wms/wmts/xyz
    coordinate_space: str = "wgs84"  # wgs84/gcj02/bd09
    url_template: str = Field(min_length=1, max_length=500)
    api_key: str = ""
    api_secret: str = ""
    enabled: bool = True


class RegionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    geometry: dict | None = None  # GeoJSON Polygon
    min_zoom: int = 0
    max_zoom: int = 18
    update_mode: str = "manual"  # daily/weekly/manual
