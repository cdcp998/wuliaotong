"""pytest 全局配置：确保测试用账号存在（数据库重建后自动补齐）。"""
from __future__ import annotations

import pytest

from app.core.security import hash_password
from app.db import SessionLocal
from app.models.sys import SysUser


@pytest.fixture(autouse=True, scope="session")
def ensure_tester_user():
    """创建"使用者"角色测试账号（幂等）。"""
    db = SessionLocal()
    try:
        if not db.query(SysUser).filter(SysUser.username == "tester_user").first():
            db.add(
                SysUser(
                    username="tester_user",
                    password_hash=hash_password("123456"),
                    real_name="测试使用者",
                    role_id=4,
                )
            )
            db.commit()
    finally:
        db.close()
    yield
