"""导航管理（动态菜单）请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class MenuReq(BaseModel):
    parent_id: int = 0  # 0=顶级分组
    name: str = Field(min_length=1, max_length=50)
    path: str = Field(default="", max_length=100, description="路由路径（菜单项）；分组留空")
    icon: str = Field(default="", max_length=50, description="图标名（前端 ICON_MAP 注册）")
    perm_code: str = Field(default="", max_length=100, description="权限码；逗号分隔=任一命中可见；空=公开")
    visible: int = Field(default=1, ge=0, le=1)
    sort: int = 0
    remark: str = Field(default="", max_length=255)


class MenuNodeOut(BaseModel):
    id: int
    parent_id: int
    name: str
    path: str
    icon: str
    perm_code: str
    visible: int
    sort: int
    remark: str = ""
    children: list["MenuNodeOut"] = []
