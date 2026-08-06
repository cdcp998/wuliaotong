"""系统设置接口测试（OCR 引擎/大模型 API 后台配置，L2 门禁）。"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def test_settings_get_masked():
    _login_admin()
    r = client.get("/api/v1/settings")
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["ocr.engine"] == "rapidocr"
    # 密钥脱敏：未配置为空，已配置为 **** 后四位
    assert data["llm.doubao.api_key"] == "" or data["llm.doubao.api_key"].startswith("****")
    assert "site.name" in data


def test_settings_update_ocr_engine():
    _login_admin()
    # 切到 paddle → health 显示 paddle（paddle 无本地资产 → ocr_ready False）
    r = client.put("/api/v1/settings", json={"ocr.engine": "paddle"})
    assert r.json()["code"] == 0, r.text
    assert client.get("/api/v1/health").json()["data"]["ocr_engine"] == "paddle"
    # get_ocr_engine 读库 → paddle 未实现 → NotImplementedError
    from app.db import SessionLocal
    from app.services.ocr.client import get_ocr_engine

    db = SessionLocal()
    try:
        try:
            get_ocr_engine(db)
            assert False, "应抛出 NotImplementedError"
        except NotImplementedError:
            pass
    finally:
        db.close()
    # 改回 rapidocr
    assert client.put("/api/v1/settings", json={"ocr.engine": "rapidocr"}).json()["code"] == 0
    assert client.get("/api/v1/health").json()["data"]["ocr_engine"] == "rapidocr"


def test_settings_secret_update_rule():
    _login_admin()
    # 设置新 Key
    r = client.put("/api/v1/settings", json={"llm.doubao.api_key": "sk-test-123456"})
    assert r.json()["code"] == 0
    data = client.get("/api/v1/settings").json()["data"]
    assert data["llm.doubao.api_key"] == "****3456"  # 脱敏：**** 后四位
    # 传掩码/空 → 不修改
    client.put("/api/v1/settings", json={"llm.doubao.api_key": "****3456"})
    client.put("/api/v1/settings", json={"llm.doubao.api_key": ""})
    data = client.get("/api/v1/settings").json()["data"]
    assert data["llm.doubao.api_key"] == "****3456"
    # 传新值 → 覆盖
    client.put("/api/v1/settings", json={"llm.doubao.api_key": "sk-new-0000"})
    assert client.get("/api/v1/settings").json()["data"]["llm.doubao.api_key"] == "****0000"


def test_settings_validation_and_permission():
    _login_admin()
    # 未知配置项 → 4006
    assert client.put("/api/v1/settings", json={"nope": "x"}).json()["code"] == 4006
    # 无 sys:config → 403
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.json()["code"] == 0
    assert c.get("/api/v1/settings").status_code == 403
    assert c.put("/api/v1/settings", json={"site.name": "x"}).status_code == 403
    # 未登录 → 401
    assert TestClient(app).get("/api/v1/settings").status_code == 401
