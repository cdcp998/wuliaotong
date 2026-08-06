"""认证相关请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginReq(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=100)
    captcha_id: str = Field(default="", max_length=64)
    captcha_code: str = Field(default="", max_length=8)


class PasswordReq(BaseModel):
    old_password: str = Field(min_length=1, max_length=100)
    new_password: str = Field(min_length=6, max_length=64)


class ForgotReq(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    email: str = Field(default="", max_length=100)


class ResetReq(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    code: str = Field(min_length=6, max_length=8)
    new_password: str = Field(min_length=6, max_length=64)


class RegisterReq(BaseModel):
    username: str = Field(min_length=2, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    password: str = Field(min_length=6, max_length=64)
    real_name: str = Field(default="", max_length=50)
    phone: str = Field(default="", max_length=20)
    email: str = Field(default="", max_length=100)


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
