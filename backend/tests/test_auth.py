"""认证接口测试（L2 门禁）。需要本地 MySQL 已初始化（wuliaotong 库）。"""
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.config import settings
from app.db import SessionLocal
from app.main import app
from app.models.sys import SysSession

client = TestClient(app)


def test_health():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 0
    assert body["data"]["status"] == "ok"
    assert body["data"]["db"] == "ok"
    assert body["data"]["redis"] in ("ok", "down")
    llm = body["data"]["llm"]
    assert set(llm) == {"doubao", "deepseek", "siliconflow"}
    assert all(set(v) == {"enabled", "configured", "model"} for v in llm.values())


def test_login_wrong_password():
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 200
    assert r.json()["code"] == 4004


def test_login_flow():
    # 登录成功
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 0
    user = body["data"]["user"]
    assert user["username"] == "admin"
    assert user["role"]["code"] == "super_admin"
    assert "sys:user" in user["permissions"]

    # me（会话有效）
    r2 = client.get("/api/v1/auth/me")
    assert r2.status_code == 200
    assert r2.json()["data"]["user"]["id"] == user["id"]

    # 退出后会话失效
    r3 = client.post("/api/v1/auth/logout")
    assert r3.status_code == 200
    r4 = client.get("/api/v1/auth/me")
    assert r4.status_code == 401


def test_me_without_session():
    c = TestClient(app)  # 全新客户端，无 Cookie
    r = c.get("/api/v1/auth/me")
    assert r.status_code == 401


def test_login_remember_long_session():
    """勾选「记住登录状态」→ Cookie max-age 与 DB expire_at 均按 SESSION_REMEMBER_HOURS（默认 720h=30 天）。"""
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123", "remember": True})
    assert r.status_code == 200
    assert r.json()["code"] == 0
    set_cookie = r.headers.get("set-cookie", "")
    assert f"Max-Age={int(settings.session_remember_hours * 3600)}" in set_cookie  # 2592000

    # DB 会话过期时间 ≈ 当前时间 + 720h（允许少量偏差）
    db = SessionLocal()
    try:
        row = db.query(SysSession).order_by(SysSession.id.desc()).first()
        assert row is not None
        expect = datetime.now() + timedelta(hours=settings.session_remember_hours)
        assert abs((row.expire_at - expect).total_seconds()) < 300
    finally:
        db.close()
    client.post("/api/v1/auth/logout")


def test_login_without_remember_short_session():
    """不勾选 → Cookie max-age 与 DB expire_at 按 SESSION_EXPIRE_HOURS（默认 8h）。"""
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    assert r.json()["code"] == 0
    set_cookie = r.headers.get("set-cookie", "")
    assert f"Max-Age={int(settings.session_expire_hours * 3600)}" in set_cookie  # 28800

    db = SessionLocal()
    try:
        row = db.query(SysSession).order_by(SysSession.id.desc()).first()
        assert row is not None
        expect = datetime.now() + timedelta(hours=settings.session_expire_hours)
        assert abs((row.expire_at - expect).total_seconds()) < 300
    finally:
        db.close()
    client.post("/api/v1/auth/logout")
