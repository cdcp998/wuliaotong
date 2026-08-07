"""初始化安装请求模型（《后端API设计.md》§1.1）。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class InitReq(BaseModel):
    site_name: str = Field(min_length=1, max_length=50)
    admin_username: str = Field(min_length=2, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    admin_password: str = Field(min_length=6, max_length=64)
    contact_phone: str = Field(default="", max_length=20)
