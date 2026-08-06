"""认证相关请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginReq(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=100)


class RoleInfo(BaseModel):
    id: int
    code: str
    name: str


class UserInfo(BaseModel):
    id: int
    username: str
    real_name: str
    role: RoleInfo | None
    permissions: list[str]


class LoginResp(BaseModel):
    user: UserInfo
