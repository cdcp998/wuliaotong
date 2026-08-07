"""初始化安装接口测试（L2 门禁，《后端API设计.md》§1.1）。

初始化完成状态以文件系统标记文件（backend/data/.initialized）判断，不依赖数据库。
注意：本仓库测试与开发共用数据库与同一标记文件，测试前后保存/恢复标记文件、
管理员密码、site.name、site.contact_phone，避免污染开发环境（沿用 test_settings.py 模式）。
"""
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models.sys import SysConfig, SysUser
from app.api.init import MARK_FILE

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


def _save_state() -> dict:
    """保存初始化相关状态（标记文件 + 管理员密码 + 站点配置），测试后恢复。"""
    with SessionLocal() as s:
        admin = s.scalar(select(SysUser).where(SysUser.username == "admin"))
        return {
            "mark_exists": MARK_FILE.exists(),
            "mark_content": MARK_FILE.read_text(encoding="utf-8") if MARK_FILE.exists() else None,
            "admin_password_hash": admin.password_hash if admin else None,
            "site_name": _raw_config("site.name"),
            "contact_phone": _raw_config("site.contact_phone"),
        }


def _restore_state(state: dict) -> None:
    """恢复标记文件与配置原状（标记文件原存在则还原内容，否则删除）。"""
    if state["mark_exists"]:
        MARK_FILE.parent.mkdir(parents=True, exist_ok=True)
        MARK_FILE.write_text(state["mark_content"] or "", encoding="utf-8")
    else:
        MARK_FILE.unlink(missing_ok=True)
    with SessionLocal() as s:
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
    """状态接口公开可用，返回 initialized + site_name（仅文件存在性判断）。"""
    r = client.get("/api/v1/init/status")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 0
    assert isinstance(body["data"]["initialized"], bool)
    assert isinstance(body["data"]["site_name"], str)


def test_init_validation():
    """参数校验：非法账号格式/密码过短 → 4006（校验在写库/写文件之前，不改变状态）。"""
    for payload in (
        {"site_name": "", "admin_username": "admin", "admin_password": "123456"},
        {"site_name": "x", "admin_username": "a!", "admin_password": "123456"},
        {"site_name": "x", "admin_username": "admin", "admin_password": "123"},
    ):
        r = client.post("/api/v1/init", json=payload)
        assert r.json()["code"] == 4006, (payload, r.text)


def test_init_flow_and_guard():
    """完整初始化流程 + 防重入 + 标记文件原子写入；结束后恢复开发环境状态。"""
    state = _save_state()
    try:
        MARK_FILE.unlink(missing_ok=True)  # 模拟未初始化
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
        # 状态已初始化、标记文件已创建且内容含完成时间、配置已写入
        data = client.get("/api/v1/init/status").json()["data"]
        assert data["initialized"] is True
        assert data["site_name"] == "物料通管理系统"
        assert MARK_FILE.exists()
        assert "initialized_at=" in MARK_FILE.read_text(encoding="utf-8")
        assert _raw_config("site.contact_phone") == "13800000000"
        # 管理员账号仍可登录（密码已按提交值重置）
        r2 = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        assert r2.json()["code"] == 0
        # 防重入：标记文件存在时拒绝再次执行（不依赖数据库状态）
        r3 = client.post(
            "/api/v1/init",
            json={"site_name": "x", "admin_username": "admin", "admin_password": "123456"},
        )
        assert r3.json()["code"] == 4006
    finally:
        _restore_state(state)


def test_init_username_conflict():
    """管理员改名与其他账号冲突 → 4006 且不写标记文件；结束后清理临时账号并恢复状态。"""
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
        MARK_FILE.unlink(missing_ok=True)
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
        # 冲突校验失败：标记文件未被创建，仍视为未初始化
        assert MARK_FILE.exists() is False
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is False
    finally:
        if temp_user:
            with SessionLocal() as s:
                s.query(SysUser).filter(SysUser.id == temp_user).delete()
                s.commit()
        _restore_state(state)


def test_mark_file_blocks_init_without_db_row():
    """标记文件存在即可阻止初始化——即使数据库里没有任何初始化状态记录（核心防强制重入场景）。"""
    state = _save_state()
    try:
        MARK_FILE.parent.mkdir(parents=True, exist_ok=True)
        MARK_FILE.write_text("initialized_at=2026-08-07 00:00:00\n", encoding="utf-8")
        # 明确删除数据库中可能残留的初始化状态行（模拟老库/数据库重建场景）
        with SessionLocal() as s:
            s.query(SysConfig).filter(SysConfig.config_key == "sys.initialized").delete()
            s.commit()
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is True
        r = client.post(
            "/api/v1/init",
            json={"site_name": "x", "admin_username": "admin", "admin_password": "123456"},
        )
        assert r.json()["code"] == 4006
        assert MARK_FILE.exists()  # 内容未被破坏
    finally:
        _restore_state(state)


def test_mark_file_write_failure_surfaces_error(monkeypatch):
    """标记文件写入失败（如目录只读）→ 5003 可读错误，初始化不谎报成功。"""
    state = _save_state()
    try:
        MARK_FILE.unlink(missing_ok=True)
        from app.api import init as init_mod

        def _boom() -> None:
            raise PermissionError("模拟只读目录")

        monkeypatch.setattr(init_mod, "_write_mark_file", _boom)
        r = client.post(
            "/api/v1/init",
            json={
                "site_name": "x",
                "admin_username": "admin",
                "admin_password": "123456",
            },
        )
        assert r.json()["code"] == 5003
        assert "标记写入失败" in r.json()["message"]
        # 失败后标记文件不存在 → 仍可重试初始化（不处于半完成状态）
        assert MARK_FILE.exists() is False
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is False
    finally:
        monkeypatch.undo()
        _restore_state(state)
