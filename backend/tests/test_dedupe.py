"""材料查重测试（P9-P1② 本地规则版，L2 门禁）：精确分组/本地相似分组。"""
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models.base import BaseProduct
from app.services.ai import dedupe


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


def test_local_similar_rule_and_group():
    """本地相似规则（不调大模型）：归一后互相包含判定 + 候选对直接生成 medium 分组。"""
    assert dedupe._norm("螺丝A") in dedupe._norm("不锈钢螺丝A")
    tag = uuid.uuid4().hex[:6]
    with SessionLocal() as db:
        unit = db.scalar(select(BaseProduct).limit(1)).unit_id
        p1 = BaseProduct(code="9" + str(int(tag, 16) % 10**9), name=f"螺丝{tag}", spec="M6", unit_id=unit)
        p2 = BaseProduct(code="9" + str(int(tag, 16) % 10**9 + 1), name=f"不锈钢螺丝{tag}", spec="M6", unit_id=unit)
        db.add_all([p1, p2])
        db.commit()
        groups = dedupe.dedupe_scan(db, max_pairs=500)
        medium = [g for g in groups if g["confidence"] == "medium"]
        assert medium, groups  # 本地规则直接分组（候选池受测试库影响，存在即可）
        assert all("名称相似" in g["reason"] for g in medium)
