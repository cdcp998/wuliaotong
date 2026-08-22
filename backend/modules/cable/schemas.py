"""cable 模块 Pydantic schemas。"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

LAT_RANGE = (-90.0, 90.0)
LNG_RANGE = (-180.0, 180.0)


class PointIn(BaseModel):
    lat: float = Field(description="纬度 WGS84")
    lng: float = Field(description="经度 WGS84")
    label: str = ""

    @field_validator("lat")
    @classmethod
    def _lat(cls, v: float) -> float:
        if not (LAT_RANGE[0] <= v <= LAT_RANGE[1]):
            raise ValueError("纬度超出范围")
        return v

    @field_validator("lng")
    @classmethod
    def _lng(cls, v: float) -> float:
        if not (LNG_RANGE[0] <= v <= LNG_RANGE[1]):
            raise ValueError("经度超出范围")
        return v


class CableCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    type: str = "wire"  # wire/fiber/network
    points: list[PointIn] = Field(min_length=2, description="路径节点（>=2 个）")
    status: int = 1
    description: str = ""

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v not in ("wire", "fiber", "network"):
            raise ValueError("type 必须是 wire/fiber/network")
        return v


class CableUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    status: int | None = None
    description: str | None = None

    @field_validator("type")
    @classmethod
    def _type(cls, v: str | None) -> str | None:
        if v is not None and v not in ("wire", "fiber", "network"):
            raise ValueError("type 必须是 wire/fiber/network")
        return v


class PointsUpdate(BaseModel):
    """追加/重排路径节点（整体替换坐标点集，保留 label 由前端传回）。"""

    points: list[PointIn] = Field(min_length=2)


class StatusUpdate(BaseModel):
    status: int  # 1在用 0停用 2归档


class MarkerCreate(BaseModel):
    lat: float
    lng: float
    marker_type: str = ""
    label: str = ""
    remark: str = ""


class FaultCreate(BaseModel):
    cable_id: int | None = None
    lat: float
    lng: float
    fault_type: str = ""
    severity: int = 1
    description: str = ""
    photos_note: str = ""


class FaultUpdate(BaseModel):
    cable_id: int | None = None
    severity: int | None = None
    description: str | None = None
    fault_type: str | None = None


class FaultStatusUpdate(BaseModel):
    status: int  # 0-4


class FaultPhotoIn(BaseModel):
    file_id: int
    category: str = "现场"  # 故障位置/现场/维修后
    remark: str = ""


class MeasureReq(BaseModel):
    cable_id: int
    distance: float = Field(gt=0, description="目标距离（米）")


class NavigateReq(BaseModel):
    lat: float
    lng: float
    fault_id: int
    heading: float | None = Field(default=None, description="当前航向（度），用于候选线缆过滤")


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
