"""模板自动学习测试（P9-P0 模板自动学习，L2 门禁）：3 次命中自动生成/手动模板不被覆盖。"""
import uuid

from sqlalchemy import select

from app.api.ocr import _maybe_learn_template
from app.db import SessionLocal
from app.models.base import BaseProduct, BaseUnit
from app.services.ocr import product_template


def _any_product(db):
    p = db.scalar(select(BaseProduct).limit(1))
    if p is not None:
        return p
    # 库为空（测试自动清理后）时自建一个，避免依赖其他测试的残留数据；测试后由清理器移除
    unit = db.scalar(select(BaseUnit).limit(1))
    p = BaseProduct(
        code="9" + str(uuid.uuid4().int % 10**9),
        name="模板学习测试物料",
        unit_id=unit.id if unit else 1,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def test_auto_learn_after_three_hits():
    with SessionLocal() as db:
        p = _any_product(db)
        before = product_template.load_templates(db)
        before_auto = [t for t in before if t.get("auto")]
        try:
            for _ in range(3):
                _maybe_learn_template(db, p.id, f"测试命中行 {p.name}", p.spec or "")
            after = product_template.load_templates(db)
            auto = [t for t in after if t.get("auto")]
            assert len(auto) == len(before_auto) + 1, after
            assert auto[-1]["product_name"] == p.name and auto[-1]["anchors"] == [f"测试命中行 {p.name}"]
        finally:
            product_template.save_templates(db, before)


def test_auto_does_not_override_manual():
    with SessionLocal() as db:
        p = _any_product(db)
        before = product_template.load_templates(db)
        manual = {
            "id": "manual-test", "name": p.name, "brand": "", "product_name": p.name,
            "spec": "", "anchors": ["手动锚点行"], "created_at": "2026-08-07T00:00:00",
        }
        try:
            product_template.save_templates(db, before + [manual])
            for _ in range(3):
                _maybe_learn_template(db, p.id, "手动锚点行", "")
            after = product_template.load_templates(db)
            m = [t for t in after if t.get("id") == "manual-test"]
            assert len(m) == 1 and not m[0].get("auto")  # 手动模板保留
        finally:
            product_template.save_templates(db, before)
