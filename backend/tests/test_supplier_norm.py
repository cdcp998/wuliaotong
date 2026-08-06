"""供应商名称归一测试（P9-P1③ 本地规则版，L2 门禁）：本地包含规则命中/未命中/合并转移。"""
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models.base import BaseProductSupplier, BaseSupplier
from app.services.ai import supplier_norm


def test_local_match_by_containment():
    """简称 ⊂ 全称 → 本地规则命中（不调大模型）。"""
    tag = uuid.uuid4().hex[:6]
    with SessionLocal() as db:
        sup = BaseSupplier(code="SUP" + tag, name=f"{tag}五金有限公司", remark="")
        db.add(sup)
        db.commit()
        sid, sname = supplier_norm.match_supplier_by_llm(db, f"{tag}五金")
        assert sid == sup.id and sname == sup.name


def test_local_no_match():
    with SessionLocal() as db:
        assert supplier_norm.match_supplier_by_llm(db, "完全不存在的供应商xyz123") == (0, "")


def test_merge_suppliers_transfers_and_disables():
    tag = uuid.uuid4().hex[:6]
    with SessionLocal() as db:
        a = BaseSupplier(code="SUPA" + tag, name=f"合并源{tag}", remark="")
        b = BaseSupplier(code="SUPB" + tag, name=f"合并目标{tag}", remark="")
        db.add_all([a, b])
        db.flush()
        p = db.scalar(select(BaseProductSupplier).limit(1))
        link = None
        if p:
            link = BaseProductSupplier(product_id=p.product_id, supplier_id=a.id)
            db.add(link)
        db.commit()
        from fastapi.testclient import TestClient
        from app.main import app
        c = TestClient(app)
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        r = c.post("/api/v1/suppliers/merge", json={"from_id": a.id, "to_id": b.id})
        assert r.json()["code"] == 0, r.text
        db.expire_all()
        assert db.get(BaseSupplier, a.id).status == 0
        if link:
            moved = db.scalar(
                select(BaseProductSupplier).where(
                    BaseProductSupplier.product_id == link.product_id, BaseProductSupplier.supplier_id == b.id
                )
            )
            assert moved is not None
