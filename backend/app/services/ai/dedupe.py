"""材料查重/合并建议（P9-P1②，纯本地不用 LLM）：名称精确相同必查 + 名称归一后互相包含/前缀一致的相似分组。

只给建议不落库（除人工「标记重复」写 remark）；误判由人工过滤。
"""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.base import BaseProduct, BaseUnit


def _norm(name: str) -> str:
    """名称归一：去空格/全半角/常见标点，转小写（用于相似候选筛选）。"""
    s = name.lower().replace(" ", "").replace("　", "")
    return re.sub(r"[（）()【】\[\]·\-_/\\,:：;；]", "", s)


def dedupe_scan(db: Session, max_pairs: int = 60) -> list[dict]:
    """扫描启用材料，返回疑似重复分组 [{group: [...], reason, confidence}]。

    策略：①名称精确相同 → 必查分组（confidence=high）；②名称归一后互相包含/前缀相同且长度差≤4
    → 候选对（≤max_pairs）交 DeepSeek 判断（confidence=low/medium）。
    """
    rows = db.scalars(select(BaseProduct).where(BaseProduct.status == 1).order_by(BaseProduct.id)).all()
    groups: list[dict] = []
    seen_pids: set[int] = set()

    def _item(p: BaseProduct) -> dict:
        unit_name = ""
        if p.unit_id:
            u = db.get(BaseUnit, p.unit_id)
            unit_name = u.name if u else ""
        return {
            "product_id": p.id, "name": p.name, "spec": p.spec,
            "material_code": p.material_code, "unit_name": unit_name,
        }

    # ① 名称精确相同
    by_name: dict[str, list[BaseProduct]] = {}
    for p in rows:
        by_name.setdefault(p.name, []).append(p)
    for name, ps in by_name.items():
        if len(ps) >= 2:
            group = [_item(p) for p in ps]
            groups.append({"group": group, "reason": "名称完全相同", "confidence": "high"})
            for p in ps:
                seen_pids.add(p.id)

    # ② 名称相似候选对（精确分组之外的材料）
    rest = [p for p in rows if p.id not in seen_pids]
    pairs: list[tuple[BaseProduct, BaseProduct]] = []
    for i in range(len(rest)):
        for j in range(i + 1, len(rest)):
            a, b = rest[i], rest[j]
            na, nb = _norm(a.name), _norm(b.name)
            if not na or not nb:
                continue
            # 互相包含，或前缀相同且长度差 ≤4
            if (na in nb or nb in na) and abs(len(na) - len(nb)) <= 8:
                pairs.append((a, b))
            elif len(na) >= 4 and len(nb) >= 4 and na[:4] == nb[:4]:
                pairs.append((a, b))
            if len(pairs) >= max_pairs:
                break
        if len(pairs) >= max_pairs:
            break
    if not pairs:
        return groups

    # 本地相似规则直接分组（P9-P2 确认不用 LLM）：名称归一后互相包含/前缀一致视为疑似重复，
    # 人工确认后标记（mark-duplicate），误判由人工过滤
    for a, b in pairs:
        groups.append({
            "group": [_item(a), _item(b)],
            "reason": "名称相似（归一后互相包含或前缀一致）",
            "confidence": "medium",
        })
    return groups
