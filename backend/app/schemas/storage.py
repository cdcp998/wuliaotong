"""存储位置（多存储地址）请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class StorageReq(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    type: str = "local"  # 当前仅 local（网络盘/NAS 后期扩展）
    path: str = Field(min_length=1, max_length=500, description="绝对路径或相对 backend/ 的目录")
    policy: str = Field(default="fill", pattern="^(fill|round|manual)$")
    is_default: int = 0
    status: int = 1  # 1 启用 / 0 停用
    remark: str = ""

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v != "local":
            raise ValueError("当前仅支持 local 本地目录")
        return v

    @field_validator("status")
    @classmethod
    def _status(cls, v: int) -> int:
        if v not in (0, 1):
            raise ValueError("status 只能为 0 或 1")
        return v


class StorageOut(BaseModel):
    id: int
    name: str
    type: str
    path: str
    policy: str
    is_default: int
    status: int
    remark: str
    file_count: int = 0  # 已存文件数（列表统计）
