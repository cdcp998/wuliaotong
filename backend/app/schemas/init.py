"""初始化安装请求模型（《后端API设计.md》§1.1）。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class InitReq(BaseModel):
    site_name: str = Field(min_length=1, max_length=50)
    admin_username: str = Field(min_length=2, max_length=50, pattern=r"^[a-zA-Z0-9_\-]+$")
    admin_password: str = Field(min_length=6, max_length=64)
    contact_phone: str = Field(default="", max_length=20)

    # 数据库连接（提交时自动验证，失败阻止安装；目标库不存在自动建库+导入 init.sql）
    # host 限定安全字符：拼入 URL 连接串，含 @/:/# 等字符可篡改解析
    db_host: str = Field(default="127.0.0.1", min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.\-]+$")
    db_port: int = Field(default=3306, ge=1, le=65535)
    db_user: str = Field(min_length=1, max_length=100)  # 连接串中经 quote() 编码，无需限字符
    # 接口层允许空串（兼容无密码本地 MySQL）；安装页前端必填
    db_password: str = Field(default="", max_length=200)
    # 限字母/数字/下划线：建库时作为标识符拼接（防注入），非法库名直接 4006
    db_name: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_]+$")

    # Redis 配置（连接失败降级不阻止，提示重启后生效）
    redis_host: str = Field(default="127.0.0.1", min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.\-]+$")
    redis_port: int = Field(default=6379, ge=1, le=65535)
    redis_password: str = Field(default="", max_length=200)
    redis_db: int = Field(default=0, ge=0, le=15)
