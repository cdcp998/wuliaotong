"""供应商名称归一（P9-P1③）：送货单识别供应商名与库中供应商别名/简写/错字判断为同一实体，
复用已有供应商避免重复建档。DeepSeek 不可用/失败返回 (0, "")（维持精确匹配现状）。

接入点：/ocr/delivery/confirm 精确匹配失败后调用。
"""
from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.response import BizError
from app.models.base import BaseSupplier
from app.services.llm import LLMNotConfigured, get_llm

SUPPLIER_NORM_PROMPT = (
    "你是供应商数据管理员。判断「识别出的供应商名称」与候选供应商是否为同一实体"
    "（简称/全称/错别字/后缀差异（如「有限公司」「商贸」）视为同一供应商；不同行业的同名不算）。"
    "只输出JSON数组，每项 {idx, same(布尔), reason(简短理由)}。\n"
)


def _norm(name: str) -> str:
    s = name.lower().replace(" ", "").replace("　", "")
    return re.sub(r"[（）()【】\[\]·\-_/\\\\,:：;；]", "", s)


def match_supplier_by_llm(db: Session, name: str) -> tuple[int, str]:
    """识别供应商名 → 库中同一实体（≤5 候选交 DeepSeek 判断）；返回 (supplier_id, matched_name)，未命中 (0, "")。"""
    norm = _norm(name)
    if len(norm) < 2:
        return 0, ""
    cands: list[BaseSupplier] = []
    for s in db.scalars(select(BaseSupplier).where(BaseSupplier.status == 1).order_by(BaseSupplier.id)).all():
        sn = _norm(s.name)
        if not sn:
            continue
        if (norm in sn or sn in norm) or (len(norm) >= 4 and len(sn) >= 4 and norm[:4] == sn[:4]):
            cands.append(s)
            if len(cands) >= 5:
                break
    if not cands:
        return 0, ""
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return 0, ""
    lines = [f"{i}: {s.name}" for i, s in enumerate(cands)]
    try:
        content = llm.chat_text("只输出JSON数组，不要解释", SUPPLIER_NORM_PROMPT + f"识别名：{name}\n候选：\n" + "\n".join(lines), scene="supplier_norm")
        start, end = content.find("["), content.rfind("]")
        result = json.loads(content[start : end + 1]) if start >= 0 and end >= 0 else []
    except (BizError, json.JSONDecodeError):
        return 0, ""
    for r in result:
        if isinstance(r, dict) and r.get("same") and isinstance(r.get("idx"), int) and 0 <= r["idx"] < len(cands):
            return cands[r["idx"]].id, cands[r["idx"]].name
    return 0, ""
