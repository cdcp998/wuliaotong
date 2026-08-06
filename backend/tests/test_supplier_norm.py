"""供应商名称归一测试（P9-P1③，L2 门禁）：LLM 别名命中/未配置降级/合并转移。"""
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models.base import BaseProductSupplier, BaseSupplier
from app.services.ai import supplier_norm
from app.services.llm import LLMNotConfigured


class _FakeLLM:
    name = "deepseek"

    def __init__(self, content: str) -> None:
        self.content = content

    def chat_text(self, system: str, user: str) -> str:
        return self.content


def test_match_by_llm_hit(monkeypatch):
    tag = uuid.uuid4().hex[:6]
    with SessionLocal() as db:
        sup = BaseSupplier(code="SUP" + tag, name=f"测试五金{tag}有限公司", remark="")
        db.add(sup)
        db.commit()
        monkeypatch.setattr(supplier_norm, "get_llm", lambda db_, name: _FakeLLM('[{"idx": 0, "same": true, "reason": "同一实体"}]'))
        sid, sname = supplier_norm.match_supplier_by_llm(db, f"测试五金{tag}")
        assert sid == sup.id and sname == sup.name


def test_match_by_llm_fallback_without_llm(monkeypatch):
    monkeypatch.setattr(supplier_norm, "get_llm", lambda db, name: (_ for _ in ()).throw(LLMNotConfigured("未配置")))
    with SessionLocal() as db:
        assert supplier_norm.match_supplier_by_llm(db, "不存在的供应商xyz") == (0, "")


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
        # 调接口逻辑（直接函数级：复制 merge 逻辑验证）
        from app.api.base_data import merge_suppliers
        from fastapi.testclient import TestClient
        from app.main import app
        c = TestClient(app)
        c.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        r = c.post("/api/v1/suppliers/merge", json={"from_id": a.id, "to_id": b.id})
        assert r.json()["code"] == 0, r.text
        db.expire_all()
        assert db.get(BaseSupplier, a.id).status == 0  # 源停用
        if link:
            moved = db.scalar(
                select(BaseProductSupplier).where(
                    BaseProductSupplier.product_id == link.product_id, BaseProductSupplier.supplier_id == b.id
                )
            )
            assert moved is not None  # 关联已转移
