"""材料查重/合并建议（P9-P1②）：名称精确重复必查 + 名称相似候选 DeepSeek 判断 → 疑似重复分组。

只给建议不落库（除人工「标记重复」写 remark）；DeepSeek 不可用时降级为仅精确分组。
"""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.response import BizError
from app.models.base import BaseProduct, BaseUnit
from app.services.llm import LLMNotConfigured, get_llm

DEDUPE_PROMPT = (
    "你是物料管理员。以下候选材料对（名称/规格/物料编码/单位）疑似重复，请判断每一对是否为同一材料"
    "（同名不同写法、规格描述差异、全半角/标点差异视为同一材料；仅名称相同但规格明显不同不是同一材料）。"
    "只输出JSON数组，每项 {idx, same(布尔), reason(简短理由)}。\n候选：\n"
)


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

    # DeepSeek 判断候选对
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return groups  # 降级：仅精确分组
    lines = [
        f"{i}: A={a.name}(规格:{a.spec or '-'},编码:{a.material_code or '-'},单位:{_item(a)['unit_name'] or '-'}) | "
        f"B={b.name}(规格:{b.spec or '-'},编码:{b.material_code or '-'},单位:{_item(b)['unit_name'] or '-'})"
        for i, (a, b) in enumerate(pairs)
    ]
    try:
        content = llm.chat_text("只输出JSON数组，不要解释", DEDUPE_PROMPT + "\n".join(lines))
        start, end = content.find("["), content.rfind("]")
        result = __import__("json").loads(content[start : end + 1]) if start >= 0 and end >= 0 else []
    except Exception:  # noqa: BLE001 解析失败降级
        return groups
    for idx, r in enumerate(result):
        if not isinstance(r, dict) or not r.get("same") or idx >= len(pairs):
            continue
        a, b = pairs[idx]
        groups.append({
            "group": [_item(a), _item(b)],
            "reason": f"AI 判断：{str(r.get('reason') or '名称相似')}",
            "confidence": "medium",
        })
    return groups
