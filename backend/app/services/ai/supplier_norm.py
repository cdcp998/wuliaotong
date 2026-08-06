"""供应商名称归一（P9-P1③）：送货单识别供应商名与库中供应商别名/简写/错字判断为同一实体，
复用已有供应商避免重复建档。DeepSeek 不可用/失败返回 (0, "")（维持精确匹配现状）。

接入点：/ocr/delivery/confirm 精确匹配失败后调用。
"""
from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.base import BaseSupplier

SUPPLIER_NORM_PROMPT = (
    "你是供应商数据管理员。判断「识别出的供应商名称」与候选供应商是否为同一实体"
    "（简称/全称/错别字/后缀差异（如「有限公司」「商贸」）视为同一供应商；不同行业的同名不算）。"
    "只输出JSON数组，每项 {idx, same(布尔), reason(简短理由)}。\n"
)


def _norm(name: str) -> str:
    s = name.lower().replace(" ", "").replace("　", "")
    return re.sub(r"[（）()【】\[\]·\-_/\\\\,:：;；]", "", s)


def match_supplier_by_llm(db: Session, name: str) -> tuple[int, str]:
    """本地供应商别名归一（P9-P1③，纯本地不用 LLM）：识别名与库中启用供应商归一后
    互相包含（简称/全称/后缀差异，如「海口耐沃」⊆「海口耐沃办公设备有限公司」）
    或前缀前 4 字一致且长度差≤4 → 视为同一实体；返回 (supplier_id, matched_name)，未命中 (0, "")。
    """
    norm = _norm(name)
    if len(norm) < 2:
        return 0, ""
    best: BaseSupplier | None = None
    for s in db.scalars(select(BaseSupplier).where(BaseSupplier.status == 1).order_by(BaseSupplier.id)).all():
        sn = _norm(s.name)
        if not sn:
            continue
        if (norm in sn or sn in norm) and min(len(norm), len(sn)) >= 2 and abs(len(norm) - len(sn)) <= 8:
            best = s
            break
        if (
            best is None
            and len(norm) >= 4 and len(sn) >= 4
            and norm[:4] == sn[:4] and abs(len(norm) - len(sn)) <= 4
        ):
            best = s
            break
    return (best.id, best.name) if best else (0, "")
