"""认证接口测试（L2 门禁）。需要本地 MySQL 已初始化（wuliaotong 库）。"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 0
    assert body["data"]["status"] == "ok"
    assert body["data"]["db"] == "ok"


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
