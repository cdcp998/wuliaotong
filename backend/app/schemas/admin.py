"""系统管理请求/响应模型（P7：用户/角色/日志/备份）。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class UserCreateReq(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=6, max_length=64)
    real_name: str = Field(default="", max_length=50)
    phone: str = Field(default="", max_length=20)
    role_id: int = Field(gt=0)


class UserUpdateReq(BaseModel):
    real_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=20)
    role_id: int | None = Field(default=None, gt=0)
    status: int | None = Field(default=None)
    password: str | None = Field(default=None, min_length=6, max_length=64)

    @field_validator("status")
    @classmethod
    def _status(cls, v: int | None) -> int | None:
        if v is not None and v not in (0, 1):
            raise ValueError("status 仅支持 0 停用 / 1 启用")
        return v


class RoleCreateReq(BaseModel):
    code: str = Field(min_length=2, max_length=30, pattern=r"^[a-z][a-z0-9:_-]*$")
    name: str = Field(min_length=1, max_length=50)
    description: str = Field(default="", max_length=255)


class RoleUpdateReq(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=255)


class RolePermReq(BaseModel):
    permission_ids: list[int] = Field(default_factory=list)


class UserOut(BaseModel):
    id: int
    username: str
    real_name: str
    phone: str
    role_id: int
    role_name: str
    status: int
    last_login_at: Any = None
    created_at: Any = None


class RoleOut(BaseModel):
    id: int
    code: str
    name: str
    description: str
    is_builtin: int
    permission_ids: list[int]
    permission_codes: list[str]


class BackupOut(BaseModel):
    id: int
    file_path: str
    file_size: int
    backup_type: str
    status: int
    created_at: Any = None
