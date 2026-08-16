"""pytest 全局配置。

- 支持 `TEST_DB_URL`：测试库隔离。设置后（如 mysql+pymysql://root:***@127.0.0.1:3306/wuliaotong_test）
  所有测试经独立测试库运行，并启用 `wlt-test:` Redis key 前缀隔离，避免与开发/生产库串数据。
  未设置时沿用 backend/.env 指向的开发库（会打印警告）。
- 确保测试账号存在（数据库重建后自动补齐）：
  * admin / admin123：仅当 admin 密码为无效占位（init.sql 的 `!`）时重置为测试口令；
    若管理员已改密，测试会明确报错，不会擅自覆盖真实密码。
  * tester_user / 123456：普通使用者角色测试账号。
"""
import os
import warnings

# 必须在 import app.* 之前设置 DB_URL，让 app.config.settings 读取到测试库地址
_TEST_DB_URL = os.getenv("TEST_DB_URL", "")
if _TEST_DB_URL:
    os.environ["DB_URL"] = _TEST_DB_URL

import pytest  # noqa: E402

from app.core.security import hash_password, verify_password  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models.sys import SysUser  # noqa: E402

if not _TEST_DB_URL:
    warnings.warn(
        "未设置 TEST_DB_URL：pytest 将直接使用 backend/.env 指向的数据库运行（有污染业务数据风险）。"
        "建议设置 TEST_DB_URL 指向独立测试库后重跑。",
        UserWarning,
        stacklevel=2,
    )


@pytest.fixture(scope="session", autouse=True)
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


@pytest.fixture(scope="session", autouse=True)
def ensure_admin_account(ensure_tester_user):
    """确保测试超管账号 admin/admin123 可用（测试契约）。

    init.sql 现在只插入不可登录的密码占位（`!`），因此：
    - admin 不存在或哈希不是 bcrypt → 用 admin123 补齐（仅测试库场景安全）；
    - 已是合法 bcrypt 但密码不是 admin123（管理员改过密）→ 明确报错，绝不覆盖真实密码。
    """
    db = SessionLocal()
    try:
        admin = db.query(SysUser).filter(SysUser.username == "admin").first()
        if admin is None:
            db.add(
                SysUser(
                    username="admin",
                    password_hash=hash_password("admin123"),
                    real_name="超级管理员",
                    role_id=1,
                    status=1,
                )
            )
            db.commit()
        else:
            raw = admin.password_hash or ""
            if not raw.startswith("$2"):
                admin.password_hash = hash_password("admin123")
                db.commit()
            elif not verify_password("admin123", raw):
                raise RuntimeError(
                    "测试需要 admin/admin123 登录，但当前 admin 已改密且未设置 TEST_DB_URL。"
                    "请设置 TEST_DB_URL 指向独立测试库，或临时改回测试口令后重跑。"
                )
    finally:
        db.close()
    yield


@pytest.fixture(scope="session", autouse=True)
def isolate_redis_keys(ensure_tester_user):
    """测试库隔离时使用独立 Redis key 前缀，并清空历史测试键，防止角色/会话缓存串库。"""
    if _TEST_DB_URL:
        from app.core import cache

        cache.KEY_PREFIX = "wlt-test:"
        cache.cache_delete_pattern("*")  # 只清 wlt-test:*（_k 自动加前缀）
    yield


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """每个用例前重置限流计数与认证内存态（跨用例累计会误伤全量测试）。"""
    from app.api import auth as auth_api
    from app.core import ratelimit

    ratelimit.limiter.clear()
    with auth_api._lock:
        auth_api._login_fail.clear()
        auth_api._captchas.clear()
        auth_api._reset_codes.clear()
        auth_api._reset_fail.clear()
        auth_api._mail_quota.clear()
        auth_api._register_quota.clear()
    yield
