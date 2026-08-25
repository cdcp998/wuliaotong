"""系统管理请求/响应模型（P7：用户/角色/日志/备份）。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class UserCreateReq(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=6, max_length=64)
    real_name: str = Field(default="", max_length=50)
    phone: str = Field(default="", max_length=20)
    email: str = Field(default="", max_length=100)
    role_id: int = Field(gt=0)
    department_id: int = Field(default=0, ge=0)  # 所属单位（0=未分配）


class UserUpdateReq(BaseModel):
    real_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=100)
    role_id: int | None = Field(default=None, gt=0)
    department_id: int | None = Field(default=None, ge=0)
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
    department_id: int = Field(default=0, ge=0)  # 所属单位（控制可见货架）


class RoleUpdateReq(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=255)
    department_id: int | None = Field(default=None, ge=0)


class RolePermReq(BaseModel):
    permission_ids: list[int] = Field(default_factory=list)


class UserOut(BaseModel):
    id: int
    username: str
    real_name: str
    phone: str
    email: str
    role_id: int
    role_name: str
    department_id: int = 0
    department_name: str = ""
    status: int
    last_login_at: Any = None
    created_at: Any = None


class RoleOut(BaseModel):
    id: int
    code: str
    name: str
    description: str
    is_builtin: int
    department_id: int
    department_name: str
    permission_ids: list[int]
    permission_codes: list[str]


class RegisterApplyOut(BaseModel):
    id: int
    username: str
    real_name: str
    phone: str
    email: str
    status: int
    created_at: Any = None


class DeptReq(BaseModel):
    code: str = Field(default="", max_length=30, description="单位编码（隐藏字段，系统自动生成数字编码，忽略传入值）")
    name: str = Field(min_length=1, max_length=100)
    remark: str = Field(default="", max_length=255)
    status: int = Field(default=1)


class DeptUpdateReq(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    remark: str | None = Field(default=None, max_length=255)
    status: int | None = Field(default=None)


class DeptOut(BaseModel):
    id: int
    code: str
    name: str
    remark: str
    status: int
    shelf_ids: list[int]


class DeptShelvesReq(BaseModel):
    shelf_ids: list[int] = Field(default_factory=list)


class BackupOut(BaseModel):
    id: int
    file_path: str
    file_size: int
    backup_type: str
    status: int
    created_at: Any = None
