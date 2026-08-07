"""初始化安装接口测试（L2 门禁，《后端API设计.md》§1.1）。

初始化完成状态以文件系统标记文件（backend/data/.initialized）判断，不依赖数据库。
数据库/Redis 连接验证与 .env 写入通过 monkeypatch 隔离（ENV_FILE 指向临时文件、
连接函数模拟成功/失败），避免污染开发环境 .env 与真实网络依赖（沿用 test_settings.py 模式）。
"""
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models.sys import SysConfig, SysUser
from app.api.init import MARK_FILE

client = TestClient(app)


def _payload(**overrides):
    """完整初始化请求（含数据库/Redis 配置）；连接验证默认被 monkeypatch 模拟。"""
    p = {
        "site_name": "物料通管理系统",
        "admin_username": "admin",
        "admin_password": "admin123",
        "db_host": "127.0.0.1",
        "db_port": 3306,
        "db_user": "root",
        "db_password": "secret@123",
        "db_name": "wuliaotong",
        "redis_host": "127.0.0.1",
        "redis_port": 6379,
        "redis_password": "",
        "redis_db": 0,
    }
    p.update(overrides)
    return p


def _mock_env(monkeypatch, tmp_path) -> None:
    """把 .env 写入目标指向临时文件（避免污染开发环境 .env）。"""
    import app.api.init as init_mod

    monkeypatch.setattr(init_mod, "ENV_FILE", tmp_path / ".env")


def _mock_conn(monkeypatch, db_err=None, redis_err=None) -> None:
    """模拟连接验证结果（None=成功）。"""
    import app.api.init as init_mod

    monkeypatch.setattr(init_mod, "_test_db_conn", lambda *a, **k: db_err)
    monkeypatch.setattr(init_mod, "_test_redis_conn", lambda *a, **k: redis_err)


def _raw_config(key: str) -> str | None:
    with SessionLocal() as s:
        cfg = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
        return cfg.config_value if cfg else None


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
    """参数校验：缺数据库配置/非法账号/密码过短 → 4006（校验在连接与写库之前）。"""
    for payload in (
        {"site_name": "x", "admin_username": "admin", "admin_password": "123456"},  # 缺 db_user/db_name
        _payload(db_user=""),
        _payload(db_name=""),
        _payload(db_port=0),
        _payload(redis_db=16),
        _payload(admin_username="a!", admin_password="123456"),
        _payload(admin_password="123"),
    ):
        r = client.post("/api/v1/init", json=payload)
        assert r.json()["code"] == 4006, (payload, r.text)


def test_init_flow_and_guard(monkeypatch, tmp_path):
    """完整初始化流程：连接验证 → 业务落库 → .env 写入 → 标记文件；防重入；结束后恢复。"""
    state = _save_state()
    try:
        _mock_env(monkeypatch, tmp_path)
        _mock_conn(monkeypatch)
        MARK_FILE.unlink(missing_ok=True)  # 模拟未初始化
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is False
        r = client.post("/api/v1/init", json=_payload())
        assert r.json()["code"] == 0, r.text
        # 标记文件已创建（原子写入）且内容含完成时间；状态已初始化
        assert MARK_FILE.exists()
        assert "initialized_at=" in MARK_FILE.read_text(encoding="utf-8")
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is True
        # .env 已写入 DB_URL/REDIS_URL（密码 URL 编码；set_key 可能加引号，解析后比较）
        env_values = dotenv_values(tmp_path / ".env")
        assert env_values["DB_URL"] == "mysql+pymysql://root:secret%40123@127.0.0.1:3306/wuliaotong?charset=utf8mb4"
        assert env_values["REDIS_URL"] == "redis://127.0.0.1:6379/0"
        # 管理员账号仍可登录（密码已按提交值重置）
        r2 = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        assert r2.json()["code"] == 0
        # 防重入：标记文件存在时拒绝再次执行（不依赖数据库状态）
        r3 = client.post("/api/v1/init", json=_payload())
        assert r3.json()["code"] == 4006
    finally:
        _restore_state(state)


def test_init_db_conn_fail(monkeypatch, tmp_path):
    """数据库连接失败 → 4006 阻止安装，不写 .env 不写标记文件。"""
    state = _save_state()
    try:
        _mock_env(monkeypatch, tmp_path)
        _mock_conn(monkeypatch, db_err="Access denied for user 'root'")
        MARK_FILE.unlink(missing_ok=True)
        r = client.post("/api/v1/init", json=_payload())
        assert r.json()["code"] == 4006
        assert "数据库连接失败" in r.json()["message"]
        assert MARK_FILE.exists() is False
        assert (tmp_path / ".env").exists() is False
    finally:
        _restore_state(state)


def test_init_redis_warning(monkeypatch, tmp_path):
    """Redis 连接失败 → 不阻止安装，响应提示降级（缓存层优雅降级直查数据库）。"""
    state = _save_state()
    try:
        _mock_env(monkeypatch, tmp_path)
        _mock_conn(monkeypatch, redis_err="Connection refused")
        MARK_FILE.unlink(missing_ok=True)
        r = client.post("/api/v1/init", json=_payload())
        assert r.json()["code"] == 0, r.text
        assert r.json()["data"]["redis_connected"] is False
        assert r.json()["data"]["redis_warning"] == "Connection refused"
        assert MARK_FILE.exists()
    finally:
        _restore_state(state)


def test_init_username_conflict(monkeypatch, tmp_path):
    """管理员改名与其他账号冲突 → 4006 且不写标记文件/.env；结束后清理临时账号并恢复。"""
    state = _save_state()
    temp_user = None
    try:
        _mock_env(monkeypatch, tmp_path)
        _mock_conn(monkeypatch)
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
        r = client.post("/api/v1/init", json=_payload(admin_username="init_conflict"))
        assert r.json()["code"] == 4006
        assert "占用" in r.json()["message"]
        assert MARK_FILE.exists() is False
        assert (tmp_path / ".env").exists() is False
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
        with SessionLocal() as s:
            s.query(SysConfig).filter(SysConfig.config_key == "sys.initialized").delete()
            s.commit()
        assert client.get("/api/v1/init/status").json()["data"]["initialized"] is True
        r = client.post("/api/v1/init", json=_payload())
        assert r.json()["code"] == 4006
        assert MARK_FILE.exists()
    finally:
        _restore_state(state)


def test_mark_file_write_failure_surfaces_error(monkeypatch, tmp_path):
    """标记文件写入失败 → 5003 可读错误，初始化不谎报成功（.env 已写、可重试）。"""
    state = _save_state()
    try:
        _mock_env(monkeypatch, tmp_path)
        _mock_conn(monkeypatch)
        MARK_FILE.unlink(missing_ok=True)
        import app.api.init as init_mod

        def _boom() -> None:
            raise PermissionError("模拟只读目录")

        monkeypatch.setattr(init_mod, "_write_mark_file", _boom)
        r = client.post("/api/v1/init", json=_payload())
        assert r.json()["code"] == 5003
        assert "标记写入失败" in r.json()["message"]
        assert MARK_FILE.exists() is False
        assert (tmp_path / ".env").exists()  # .env 已写入，重试幂等
    finally:
        _restore_state(state)


def test_env_url_encoding(monkeypatch, tmp_path):
    """密码含 URL 特殊字符时正确编码（避免破坏连接串解析）。"""
    import app.api.init as init_mod
    from app.schemas.init import InitReq

    monkeypatch.setattr(init_mod, "ENV_FILE", tmp_path / ".env")
    init_mod._write_env_config(
        InitReq(
            site_name="x",
            admin_username="admin",
            admin_password="123456",
            db_host="db.example.com",
            db_port=3307,
            db_user="my user",
            db_password="p@ss:w/rd?#",
            db_name="wlt_db",
            redis_host="r.example.com",
            redis_port=6380,
            redis_password="r@pass",
            redis_db=3,
        )
    )
    env_values = dotenv_values(tmp_path / ".env")
    assert env_values["DB_URL"] == "mysql+pymysql://my%20user:p%40ss%3Aw%2Frd%3F%23@db.example.com:3307/wlt_db?charset=utf8mb4"
    assert env_values["REDIS_URL"] == "redis://:r%40pass@r.example.com:6380/3"
