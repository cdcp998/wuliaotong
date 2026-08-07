"""预警通知正文测试（P9-P0④ 本地规则版，L2 门禁）：规则拼接含关键数据，不调大模型。"""
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models.base import BaseProduct
from app.services.ai import alert_text


def _any_product(db) -> BaseProduct:
    return db.scalar(select(BaseProduct).limit(1))


def test_alert_text_rule_based():
    """规则拼接正文：含材料名/编码/库存/上下限/近30天出库/采购价（若有）。"""
    with SessionLocal() as db:
        p = _any_product(db)
        out = alert_text.generate_alert_text(db, product=p, qty=Decimal("1"), kind="低库存")
    assert p.name in out and "库存 1" in out and "近30天出库" in out and "请及时处理" in out


def test_alert_text_high_stock():
    with SessionLocal() as db:
        p = _any_product(db)
        out = alert_text.generate_alert_text(db, product=p, qty=Decimal("9999"), kind="高库存")
    assert "高于上限" in out
