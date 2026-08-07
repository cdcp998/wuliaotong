"""初始化安装接口测试（L2 门禁，《后端API设计.md》§1.1）。

注意：本仓库测试与开发共用数据库，测试前后保存/恢复 sys.initialized、管理员密码、
site.name、site.contact_phone，避免污染开发库（沿用 test_settings.py 模式）。
"""
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models.sys import SysConfig, SysUser

client = TestClient(app)


def _raw_config(key: str) -> str | None:
    with SessionLocal() as s:
        cfg = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
        return cfg.config_value if cfg else None


def _set_config(key: str, value: str) -> None:
    with SessionLocal() as s:
        cfg = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
        if cfg:
            cfg.config_value = value
        else:
            s.add(SysConfig(config_key=key, config_value=value, remark=""))
        s.commit()


def _del_config(key: str) -> None:
    with SessionLocal() as s:
        s.query(SysConfig).filter(SysConfig.config_key == key).delete()
        s.commit()


def _save_state() -> dict:
    """保存初始化相关状态，测试后恢复。"""
    with SessionLocal() as s:
        admin = s.scalar(select(SysUser).where(SysUser.username == "admin"))
        return {
            "init_value": _raw_config("sys.initialized"),
            "admin_password_hash": admin.password_hash if admin else None,
            "site_name": _raw_config("site.name"),
            "contact_phone": _raw_config("site.contact_phone"),
        }


def _restore_state(state: dict) -> None:
    with SessionLocal() as s:
        if state["init_value"] is None:
            s.query(SysConfig).filter(SysConfig.config_key == "sys.initialized").delete()
        else:
            cfg = s.scalar(select(SysConfig).where(SysConfig.config_key == "sys.initialized"))
            if cfg:
                cfg.config_value = state["init_value"]
            else:
                s.add(SysConfig(config_key="sys.initialized", config_value=state["init_value"], remark=""))
        if state["admin_password_hash"]:
            admin = s.scalar(select(SysUser).where(SysUser.username == "admin"))
            if admin:
                admin.password_hash = state["admin_password_hash"]
        _restore_one(s, "site.name", state["site_name"])
        _restore_one(s, "site.contact_phone", state["contact_phone"])
        s.commit()


def _restore_one(s, key: str, value: str | None) -> None:
    if value is None:
        s.query(SysConfig).filter(SysConfig.config_key == key).delete()
    else:
        cfg = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
        if cfg:
            cfg.config_value = value
        else:
            s.add(SysConfig(config_key=key, config_value=value, remark=""))


def test_init_status_shape():
    """状态接口公开可用，返回 initialized + site_name。"""
    r = client.get("/api/v1/init/status")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 0
    assert "initialized" in body["data"]
    assert isinstance(body["data"]["initialized"], bool)
    assert isinstance(body["data"]["site_name"], str)


def test_init_validation():
    """参数校验：非法账号格式/密码过短 → 4006。"""
    for payload in (
        {"site_name": "", "admin_username": "admin", "admin_password": "123456"},
        {"site_name": "x", "admin_username": "a!", "admin_password": "123456"},
        {"site_name": "x", "admin_username": "admin", "admin_password": "123"},
    ):
        r = client.post("/api/v1/init", json=payload)
        assert r.json()["code"] == 4006, (payload, r.text)


def test_init_flow_and_guard():
    """完整初始化流程 + 防重入；结束后恢复开发库状态。"""
    state = _save_state()
    try:
        _set_config("sys.initialized", "0")
        # 未初始化状态
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is False
        # 执行初始化（保持 admin/admin123 与 site.name，避免影响其他测试）
        r = client.post(
            "/api/v1/init",
            json={
                "site_name": "物料通管理系统",
                "admin_username": "admin",
                "admin_password": "admin123",
                "contact_phone": "13800000000",
            },
        )
        assert r.json()["code"] == 0, r.text
        # 状态已初始化、配置已写入
        data = client.get("/api/v1/init/status").json()["data"]
        assert data["initialized"] is True
        assert data["site_name"] == "物料通管理系统"
        assert _raw_config("site.contact_phone") == "13800000000"
        # 管理员账号仍可登录（密码已按提交值重置）
        r2 = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        assert r2.json()["code"] == 0
        # 防重入：已初始化后拒绝再次执行
        r3 = client.post(
            "/api/v1/init",
            json={"site_name": "x", "admin_username": "admin", "admin_password": "123456"},
        )
        assert r3.json()["code"] == 4006
    finally:
        _restore_state(state)


def test_init_username_conflict():
    """管理员改名与其他账号冲突 → 4006；结束后清理临时账号并恢复状态。"""
    state = _save_state()
    temp_user = None
    try:
        with SessionLocal() as s:
            if not s.query(SysUser).filter(SysUser.username == "init_conflict").first():
                temp_user = SysUser(
                    username="init_conflict",
                    password_hash=hash_password("123456"),
                    real_name="冲突测试",
                    role_id=4,
                )
                s.add(temp_user)
                s.commit()
                temp_user = temp_user.id
        _set_config("sys.initialized", "0")
        r = client.post(
            "/api/v1/init",
            json={
                "site_name": "x",
                "admin_username": "init_conflict",
                "admin_password": "123456",
            },
        )
        assert r.json()["code"] == 4006
        assert "占用" in r.json()["message"]
        # 未初始化状态应保持不变（事务性校验，未写库）
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is False
    finally:
        if temp_user:
            with SessionLocal() as s:
                s.query(SysUser).filter(SysUser.id == temp_user).delete()
                s.commit()
        _restore_state(state)
