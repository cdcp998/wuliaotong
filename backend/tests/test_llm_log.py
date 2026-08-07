"""大模型调用日志测试（P9，L2 门禁）：_log_llm_call 写入与查询接口。"""
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models.sys import LlmLog
from app.services.llm import _log_llm_call

client = TestClient(app)


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def test_llm_log_write_and_query():
    with SessionLocal() as db:
        _log_llm_call("test_scene", "deepseek", "测试输入", "测试输出", "ok", "", 123, user_id=None)
        row = db.scalar(select(LlmLog).where(LlmLog.scene == "test_scene").order_by(LlmLog.id.desc()).limit(1))
        assert row is not None
        assert row.prompt == "测试输入" and row.output == "测试输出"
        assert row.status == "ok" and row.duration_ms == 123


def test_llm_log_error_recorded():
    with SessionLocal() as db:
        _log_llm_call("test_scene_err", "siliconflow", "输入", "", "error", "timeout", 999, user_id=None)
        row = db.scalar(select(LlmLog).where(LlmLog.scene == "test_scene_err").order_by(LlmLog.id.desc()).limit(1))
        assert row is not None and row.status == "error" and "timeout" in row.error


def test_llm_log_long_content_kept():
    """输入/输出超长时按 15000 字符上限保存（TEXT 列 65535 字节安全余量），详情可查看尽可能完整的内容。"""
    with SessionLocal() as db:
        _log_llm_call("test_scene_long", "deepseek", "长" * 20000, "出" * 20000, "ok", "", 1, user_id=None)
        row = db.scalar(select(LlmLog).where(LlmLog.scene == "test_scene_long").order_by(LlmLog.id.desc()).limit(1))
        assert row is not None
        assert len(row.prompt) == 15000 and len(row.output) == 15000


def test_llm_log_batch_delete():
    """批量删除接口：勾选多条后一次删除。"""
    _login_admin()
    import uuid

    tag = f"test_del_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        for i in range(3):
            _log_llm_call(f"{tag}_{i}", "deepseek", "输入", "输出", "ok", "", 1, user_id=None)
        ids = [db.scalar(select(LlmLog.id).where(LlmLog.scene == f"{tag}_{i}")) for i in range(3)]
        assert all(ids)
    r = client.request("DELETE", "/api/v1/llm-logs", json={"ids": ids})
    assert r.status_code == 200 and r.json()["code"] == 0, r.text
    assert r.json()["data"]["deleted"] == 3
    with SessionLocal() as db:
        for i in range(3):
            assert db.scalar(select(LlmLog.id).where(LlmLog.scene == f"{tag}_{i}")) is None
