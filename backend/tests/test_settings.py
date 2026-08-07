"""系统设置接口测试（OCR 引擎/大模型 API 后台配置，L2 门禁）。"""
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.api.system as sysmod
from app.db import SessionLocal
from app.main import app
from app.models.sys import SysConfig

client = TestClient(app)


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _raw_config(key: str) -> str | None:
    """直接读库取配置原值（secret 走 GET 只能拿到掩码，无法恢复）。"""
    with SessionLocal() as s:
        cfg = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
        return cfg.config_value if cfg else None


def _restore_config(key: str, value: str | None) -> None:
    """测试写库后恢复原值，避免污染开发库（本仓库测试与开发共用数据库）。

    原值不存在（用户从未配置）时删除测试写入的配置行——secret 键 PUT 空值/掩码
    均不生效，必须直接删行才能恢复「未配置」状态。
    """
    if value is None:
        from app.models.sys import SysConfig
        from sqlalchemy import select

        with SessionLocal() as s:
            row = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
            if row is not None:
                s.delete(row)
                s.commit()
        return
    _login_admin()
    assert client.put("/api/v1/settings", json={key: value}).json()["code"] == 0


def test_settings_get_masked():
    _login_admin()
    r = client.get("/api/v1/settings")
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["ocr.engine"] in ("rapidocr", "paddle")  # 不依赖全局引擎状态（其他测试/冒烟可能切换）
    # 密钥脱敏：未配置为空，已配置为 **** 后四位
    assert data["llm.doubao.api_key"] == "" or data["llm.doubao.api_key"].startswith("****")
    assert "site.name" in data


def test_settings_update_ocr_engine():
    _login_admin()
    original = _raw_config("ocr.engine")
    try:
        # 切到 paddle → health 显示 paddle（paddle 未装 paddleocr 依赖 → ocr_ready False）
        r = client.put("/api/v1/settings", json={"ocr.engine": "paddle"})
        assert r.json()["code"] == 0, r.text
        assert client.get("/api/v1/health").json()["data"]["ocr_engine"] == "paddle"
        # get_ocr_engine 读库 → 返回 PaddleOCREngine 实例（惰性初始化，未安装不抛错）
        from app.services.ocr.client import get_ocr_engine

        db = SessionLocal()
        try:
            engine = get_ocr_engine(db)
            assert engine.name == "paddle"
            # 模型版本配置可读写
            assert client.put("/api/v1/settings", json={"ocr.model_version": "PP-OCRv6"}).json()["code"] == 0
        finally:
            db.close()
        # 改回 rapidocr
        assert client.put("/api/v1/settings", json={"ocr.engine": "rapidocr"}).json()["code"] == 0
        assert client.get("/api/v1/health").json()["data"]["ocr_engine"] == "rapidocr"
    finally:
        _restore_config("ocr.engine", original)


def test_settings_secret_update_rule():
    _login_admin()
    original = _raw_config("llm.doubao.api_key")
    try:
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
    finally:
        _restore_config("llm.doubao.api_key", original)


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


def test_siliconflow_models_requires_key(monkeypatch):
    _login_admin()
    # 未配置 Key → 400（提示先保存 Key）；打桩保证确定性（测试库可能已存真实 Key）
    with monkeypatch.context() as m:
        m.setattr(sysmod, "_sys_config", lambda db, key: "")
        assert client.post("/api/v1/llm/siliconflow/models").json()["code"] == 4006
        assert client.post("/api/v1/llm/deepseek/models").json()["code"] == 4006
        assert client.post("/api/v1/llm/doubao/models").json()["code"] == 4006
    # 已配置 Key → 拉取模型列表（打桩模拟 /models 响应与已存 Key，不依赖/不写开发库）
    monkeypatch.setattr(sysmod, "_fetch_models", lambda base_url, api_key: [{"id": "deepseek-chat", "owned_by": "deepseek"}])
    with monkeypatch.context() as m:
        m.setattr(sysmod, "_sys_config", lambda db, key: "sk-test-ok" if key == "llm.siliconflow.api_key" else "")
        r = client.post("/api/v1/llm/siliconflow/models")
        assert r.json()["code"] == 0 and r.json()["data"]["models"][0]["id"] == "deepseek-chat"
    # 无 sys:config 权限 → 403
    c = TestClient(app)
    c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert c.post("/api/v1/llm/siliconflow/models").status_code == 403
    assert c.post("/api/v1/llm/deepseek/models").status_code == 403


def test_settings_image_pool_dir_removed():
    """「图片池目录」配置项已移除（与共用存储池合并）：GET 不含该键、PUT 报未知配置项。"""
    _login_admin()
    r = client.get("/api/v1/settings")
    assert r.json()["code"] == 0
    assert "image_pool.dir" not in r.json()["data"]
    r2 = client.put("/api/v1/settings", json={"image_pool.dir": "data/files"})
    assert r2.json()["code"] == 4006
    assert "未知配置项" in r2.json()["message"]
