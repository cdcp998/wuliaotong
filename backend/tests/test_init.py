"""初始化安装接口测试（L2 门禁，《后端API设计.md》§1.1）。

初始化完成状态以文件系统标记文件（backend/data/.initialized）判断，不依赖数据库。
数据库/Redis 连接验证与 .env 写入通过 monkeypatch 隔离（ENV_FILE 指向临时文件、
连接函数模拟成功/失败），避免污染开发环境 .env 与真实网络依赖（沿用 test_settings.py 模式）。
"""
import time

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
    """模拟连接验证结果（None=成功）；同时隔离目标库会话与连接热切换（避免污染全局 engine）。"""
    import app.api.init as init_mod
    from app.db import SessionLocal

    monkeypatch.setattr(init_mod, "_test_db_conn", lambda *a, **k: db_err)
    monkeypatch.setattr(init_mod, "_test_redis_conn", lambda *a, **k: redis_err)
    engine = SessionLocal.kw["bind"]
    monkeypatch.setattr(init_mod, "_target_sessionmaker", lambda req: (engine, SessionLocal))
    monkeypatch.setattr(init_mod, "_apply_runtime_config", lambda *a, **k: None)


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
            "init_ts": _raw_config("system.init_ts"),
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
        _restore_one(s, "system.init_ts", state["init_ts"])
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
        _payload(db_name="wlt-1"),  # db_name 限字母/数字/下划线（防标识符注入）
        _payload(db_name="a b"),
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


def test_split_sql_skips_comments():
    """init.sql 分句：跳过注释行与空行，多行语句合并为一条。"""
    from app.api.init import _split_sql

    sql = "-- 注释行\n\nSET NAMES utf8mb4;\nDROP TABLE IF EXISTS a;\nCREATE TABLE a (\n  id INT\n);\n"
    assert _split_sql(sql) == ["SET NAMES utf8mb4;", "DROP TABLE IF EXISTS a;", "CREATE TABLE a ( id INT );"]


def test_db_error_mapping():
    """常见 MySQL 错误码映射为中文可读提示（1045 密码错 / 1044 无权限 / 2003 连不上 / 其余原文）。"""
    from app.api.init import _errno_of, _friendly_db_error

    class _FakeExc(Exception):
        pass

    unknown = _FakeExc("(1049, \"Unknown database 'wuliaotong1'\")")
    assert _errno_of(unknown) == 1049
    assert _friendly_db_error(_FakeExc("(1045, \"Access denied for user\")")) == (
        "用户名或密码错误（Access denied），请核对数据库账号密码"
    )
    assert _friendly_db_error(_FakeExc("(1044, \"Access denied\")")) == (
        "当前数据库用户无权访问目标库，请检查授权"
    )
    assert _friendly_db_error(_FakeExc("(2003, \"Can't connect\")")) == (
        "无法连接数据库服务器，请检查地址/端口是否正确、MySQL 服务是否已启动"
    )
    assert _friendly_db_error(unknown) == str(unknown)


def _real_db_creds() -> dict:
    """从当前 .env 解析真实 MySQL 凭据（真实集成测试用）。"""
    from urllib.parse import unquote, urlparse

    from app.config import settings

    u = urlparse(settings.db_url)
    return {
        "db_host": u.hostname or "127.0.0.1",
        "db_port": u.port or 3306,
        "db_user": u.username or "root",
        "db_password": unquote(u.password or ""),
    }


def _drop_test_db(creds: dict, db_name: str) -> None:
    """清理自动建库测试创建的临时库（失败不阻塞测试）。"""
    import pymysql

    try:
        conn = pymysql.connect(
            host=creds["db_host"],
            port=creds["db_port"],
            user=creds["db_user"],
            password=creds["db_password"],
            connect_timeout=5,
        )
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{db_name}`")
        conn.commit()
        conn.close()
    except Exception:  # noqa: BLE001 清理失败仅告警
        pass


def test_init_auto_create_missing_db(monkeypatch, tmp_path):
    """目标库不存在（1049）→ 自动建库并导入 init.sql 表结构，安装成功；测试后清理临时库。"""
    import app.api.init as init_mod

    import app.db as db_mod
    from app.config import settings as st

    state = _save_state()
    creds = _real_db_creds()
    db_name = f"wlt_auto_test_{int(time.time() * 1000)}"
    original_db_url, original_redis_url = st.db_url, st.redis_url
    try:
        _mock_env(monkeypatch, tmp_path)
        MARK_FILE.unlink(missing_ok=True)
        r = client.post("/api/v1/init", json=_payload(db_name=db_name, **creds))
        assert r.json()["code"] == 0, r.text
        # 临时库已创建且表结构完整（复验连接 + 角色种子可查）
        err = init_mod._test_db_conn(
            creds["db_host"], creds["db_port"], creds["db_user"], creds["db_password"], db_name
        )
        assert err is None, err
        with SessionLocal() as s:
            from app.models.sys import SysRole

            assert s.scalar(select(SysRole).where(SysRole.code == "super_admin")) is not None
        # 进程内连接已热切换到目标库（无需重启后端）
        assert db_mod.engine.url.database == db_name
        assert st.db_url.endswith(f"/{db_name}?charset=utf8mb4")
    finally:
        # 先切回原库再恢复状态/清理临时库（SessionLocal 已随热切换指向临时库）
        db_mod.reconfigure_db(original_db_url)
        st.db_url, st.redis_url = original_db_url, original_redis_url
        _restore_state(state)
        _drop_test_db(creds, db_name)


def test_init_existing_empty_db_imports_schema(monkeypatch, tmp_path):
    """目标库已存在但为空 → 自动导入 init.sql 表结构，安装成功；测试后清理临时库。"""
    import pymysql

    import app.api.init as init_mod

    import app.db as db_mod
    from app.config import settings as st

    state = _save_state()
    creds = _real_db_creds()
    db_name = f"wlt_empty_test_{int(time.time() * 1000)}"
    original_db_url, original_redis_url = st.db_url, st.redis_url
    try:
        _mock_env(monkeypatch, tmp_path)
        # 先真实创建空库（无任何表）
        conn = pymysql.connect(
            host=creds["db_host"],
            port=creds["db_port"],
            user=creds["db_user"],
            password=creds["db_password"],
            connect_timeout=5,
        )
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE `{db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        conn.commit()
        conn.close()
        MARK_FILE.unlink(missing_ok=True)
        r = client.post("/api/v1/init", json=_payload(db_name=db_name, **creds))
        assert r.json()["code"] == 0, r.text
        err = init_mod._test_db_conn(
            creds["db_host"], creds["db_port"], creds["db_user"], creds["db_password"], db_name
        )
        assert err is None, err
        assert db_mod.engine.url.database == db_name
        assert st.db_url.endswith(f"/{db_name}?charset=utf8mb4")
    finally:
        db_mod.reconfigure_db(original_db_url)
        st.db_url, st.redis_url = original_db_url, original_redis_url
        _restore_state(state)
        _drop_test_db(creds, db_name)


def test_init_reconfigure_fail_blocks(monkeypatch, tmp_path):
    """热切换失败 → 5003 且不写标记文件（.env 已保存，提示重启后端生效）。"""
    state = _save_state()
    try:
        _mock_env(monkeypatch, tmp_path)
        _mock_conn(monkeypatch)
        MARK_FILE.unlink(missing_ok=True)
        import app.api.init as init_mod

        def _boom(*a, **k):
            raise ConnectionError("模拟切换失败")

        monkeypatch.setattr(init_mod, "_apply_runtime_config", _boom)
        r = client.post("/api/v1/init", json=_payload())
        assert r.json()["code"] == 5003
        assert "切换失败" in r.json()["message"]
        assert MARK_FILE.exists() is False
        assert (tmp_path / ".env").exists()  # .env 已保存，重启后端即可生效
    finally:
        _restore_state(state)


def test_init_auto_create_fail_blocks(monkeypatch, tmp_path):
    """自动建库失败 → 4006 阻止安装（提示含手动建库指引，原始错误仅进日志脱敏），不写 .env 与标记文件。"""
    state = _save_state()
    try:
        _mock_env(monkeypatch, tmp_path)
        _mock_conn(monkeypatch, db_err="数据库「x」不存在且自动创建失败（无法连接数据库服务器…），请手动创建后重试")
        MARK_FILE.unlink(missing_ok=True)
        r = client.post("/api/v1/init", json=_payload())
        assert r.json()["code"] == 4006
        assert "数据库连接失败" in r.json()["message"]
        assert "手动创建" in r.json()["message"]
        assert MARK_FILE.exists() is False
        assert (tmp_path / ".env").exists() is False
    finally:
        _restore_state(state)


def test_init_status_db_down(monkeypatch):
    """数据库不可用时 /init/status 仍 200（initialized 由标记文件判断，site_name 空串），安装页可正常打开。"""
    from sqlalchemy.exc import OperationalError

    class _BrokenSession:
        def scalar(self, *a, **k):
            raise OperationalError("SELECT 1", {}, Exception("(2003, Can't connect to MySQL server)"))

        def close(self):
            pass

    monkeypatch.setattr("app.db.SessionLocal", _BrokenSession)
    r = client.get("/api/v1/init/status")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 0
    assert body["data"]["site_name"] == ""
    assert isinstance(body["data"]["initialized"], bool)


def test_lifespan_startup_without_db(monkeypatch):
    """数据库不可用时后端仍能正常启动（启动自检仅告警不阻止），安装页接口可用。"""
    from sqlalchemy.exc import OperationalError

    class _BrokenEngine:
        def connect(self):
            raise OperationalError("SELECT 1", {}, Exception("(2003, Can't connect to MySQL server)"))

    monkeypatch.setattr("app.main.engine", _BrokenEngine())
    with TestClient(app) as c:  # lifespan 启动自检失败 → 仅告警，应用正常服务
        r = c.get("/api/v1/init/status")
        assert r.status_code == 200
        assert r.json()["code"] == 0
