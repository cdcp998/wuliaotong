"""大模型调用日志测试（P9，L2 门禁）：_log_llm_call 写入与查询接口。"""
from sqlalchemy import select

from app.db import SessionLocal
from app.models.sys import LlmLog
from app.services.llm import _log_llm_call


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
