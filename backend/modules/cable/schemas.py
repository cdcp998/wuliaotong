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
    lat: float | None = Field(default=None, ge=-90, le=90, description="纬度（后台标记/移动故障点）")
    lng: float | None = Field(default=None, ge=-180, le=180, description="经度（后台标记/移动故障点）")


class FaultStatusUpdate(BaseModel):
    status: int  # 0-5（0待派发/1已派发/2进行中/3完成待验/4已验证/5已关闭）


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
