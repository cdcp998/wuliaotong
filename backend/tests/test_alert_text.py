"""预警通知正文测试（P9-P0④ 本地规则版，L2 门禁）：规则拼接含关键数据，不调大模型。"""
import uuid
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models.base import BaseProduct, BaseUnit
from app.services.ai import alert_text


def _any_product(db) -> BaseProduct:
    p = db.scalar(select(BaseProduct).limit(1))
    if p is not None:
        return p
    # 库为空（测试自动清理后）时自建一个，避免依赖其他测试的残留数据；测试后由清理器移除
    unit = db.scalar(select(BaseUnit).limit(1))
    p = BaseProduct(
        code="9" + str(uuid.uuid4().int % 10**9),
        name="预警文案测试物料",
        unit_id=unit.id if unit else 1,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


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
