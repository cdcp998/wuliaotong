"""材料查重测试（P9-P1②，L2 门禁）：精确重复分组/LLM 相似判断/未配置降级。"""
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models.base import BaseProduct
from app.services.ai import dedupe
from app.services.llm import LLMNotConfigured


class _FakeLLM:
    name = "deepseek"

    def __init__(self, content: str) -> None:
        self.content = content

    def chat_text(self, system: str, user: str) -> str:
        return self.content


def test_exact_name_group():
    tag = uuid.uuid4().hex[:6]
    with SessionLocal() as db:
        unit = db.scalar(select(BaseProduct).limit(1)).unit_id
        p1 = BaseProduct(code="9" + str(int(tag, 16) % 10**9), name=f"查重材料{tag}", unit_id=unit)
        p2 = BaseProduct(code="9" + str(int(tag, 16) % 10**9 + 1), name=f"查重材料{tag}", unit_id=unit)
        db.add_all([p1, p2])
        db.commit()
        groups = dedupe.dedupe_scan(db, max_pairs=5)
        hit = [g for g in groups if g["confidence"] == "high" and any(i["product_id"] == p1.id for i in g["group"])]
        assert hit and len(hit[0]["group"]) == 2


def test_llm_similar_pair_grouped(monkeypatch):
    """LLM 相似判断链路：候选对经 DeepSeek 判定 same=true → 生成 medium 分组（不依赖特定材料对，候选池受测试库影响）。"""
    monkeypatch.setattr(dedupe, "get_llm", lambda db_, name: _FakeLLM('[{"idx": 0, "same": true, "reason": "名称相似"}]'))
    with SessionLocal() as db:
        groups = dedupe.dedupe_scan(db, max_pairs=200)
        medium = [g for g in groups if g["confidence"] == "medium"]
        assert medium, groups
        assert any("AI 判断" in g["reason"] for g in medium)


def test_fallback_without_llm(monkeypatch):
    monkeypatch.setattr(dedupe, "get_llm", lambda db, name: (_ for _ in ()).throw(LLMNotConfigured("未配置")))
    with SessionLocal() as db:
        groups = dedupe.dedupe_scan(db, max_pairs=5)
        assert all(g["confidence"] == "high" for g in groups)  # 降级只返回精确分组
