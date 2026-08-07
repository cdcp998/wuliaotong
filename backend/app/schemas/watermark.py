"""水印预览请求模型：管理员配置预览（示例底图）与真实照片预览。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class WatermarkPreviewReq(BaseModel):
    """系统设置里的水印预览：用示例底图即时渲染，未保存也可预览。"""

    template: str = Field(default="", max_length=500, description="水印模板（空=当前配置）")
    position: str = Field(default="", max_length=30, description="水印位置（空=当前配置）")
    bg_opaque: bool | None = Field(default=None, description="背景是否不透明（None=当前配置）")
    location: str = Field(default="示例地点", max_length=100)
    time: str = Field(default="2026-08-06 12:00:00", max_length=30)
    gps: str = Field(default="31.2304,121.4737", max_length=60)


class FileWatermarkReq(BaseModel):
    """真实照片水印预览：使用当前系统配置的模板与位置。"""

    location: str = Field(default="", max_length=100)
    time: str = Field(default="", max_length=30)
    lat: str = Field(default="", max_length=30)
    lng: str = Field(default="", max_length=30)
