"""预警通知智能生成测试（P9-④，L2 门禁）：AI 生效/未配置降级/开关关闭。"""
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models.base import BaseProduct
from app.services.ai import alert_text
from app.services.llm import LLMNotConfigured


class _FakeLLM:
    name = "deepseek"

    def __init__(self, content: str) -> None:
        self.content = content

    def chat_text(self, system: str, user: str) -> str:
        return self.content


def _any_product(db) -> BaseProduct:
    return db.scalar(select(BaseProduct).limit(1))


def test_alert_ai_text_used(monkeypatch):
    monkeypatch.setattr(alert_text, "get_llm", lambda db, name: _FakeLLM("轴承6204 库存不足，近30天消耗10件，建议补货15件（紧急）"))
    with SessionLocal() as db:
        p = _any_product(db)
        out = alert_text.generate_alert_text(db, product=p, qty=Decimal("1"), kind="低库存")
    assert "轴承6204" in out and "建议" in out


def test_alert_fallback_when_not_configured(monkeypatch):
    monkeypatch.setattr(alert_text, "get_llm", lambda db, name: (_ for _ in ()).throw(LLMNotConfigured("未配置")))
    with SessionLocal() as db:
        p = _any_product(db)
        out = alert_text.generate_alert_text(db, product=p, qty=Decimal("1"), kind="低库存")
    assert "库存 1" in out and "近30天出库" in out  # 规则模板兜底


def test_alert_fallback_when_disabled():
    from app.models.sys import SysConfig
    with SessionLocal() as db:
        old = db.scalar(select(SysConfig).where(SysConfig.config_key == "ai.alert_enabled"))
        try:
            cfg = old or SysConfig(config_key="ai.alert_enabled", config_value="0", remark="")
            if old is None:
                db.add(cfg)
            else:
                cfg.config_value = "0"
            db.commit()
            p = _any_product(db)
            out = alert_text.generate_alert_text(db, product=p, qty=Decimal("2"), kind="高库存")
            assert "近30天出库" in out
        finally:
            if old is None:
                db.delete(cfg)
            else:
                old.config_value = "1"
            db.commit()
