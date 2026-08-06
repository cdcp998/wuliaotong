"""领用审核 AI 辅助摘要（P9-P1⑤）：规则聚合领用单上下文（明细/库存/历史频率/私用标记），
DeepSeek 生成 {summary, risk_level, reasons}；未配置/失败返回规则版摘要（risk_level=规则判断）。

接入点：GET /requisitions/{id}/ai-summary（req:audit）。
"""
from __future__ import annotations

import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.response import BizError
from app.models.base import BaseProduct
from app.models.requisition import OutRequisition, OutRequisitionItem
from app.models.stock import StkStock
from app.models.sys import SysUser
from app.services.llm import LLMNotConfigured, get_llm

SUMMARY_PROMPT = (
    "你是仓库审核助手。根据以下领用申请数据，生成审核辅助摘要："
    "输出JSON {\"summary\": 60字内中文摘要（含申请人/材料/数量/库存状况）, "
    "\"risk_level\": \"低\"或\"中\"或\"高\", \"reasons\": [1-3条风险原因]}。"
    "库存不足、高频领用、私用标记是高风险信号。只输出JSON。\n数据：\n"
)


def ai_summary(db: Session, req: OutRequisition, items: list[OutRequisitionItem]) -> dict:
    """生成领用审核摘要（规则版兜底 + AI 润色）。"""
    # ---- 规则聚合 ----
    applicant = db.get(SysUser, req.applicant_id)
    applicant_name = applicant.username if applicant else f"#{req.applicant_id}"
    # 近 30 天该申请人领用次数
    from datetime import datetime, timedelta

    since = datetime.now() - timedelta(days=30)
    freq = db.scalar(
        select(func.count(OutRequisition.id)).where(
            OutRequisition.applicant_id == req.applicant_id, OutRequisition.created_at >= since
        )
    ) or 0
    rows: list[dict] = []
    shortage = 0
    total_amount = 0
    for it in items:
        p = db.get(BaseProduct, it.product_id)
        name = p.name if p else f"#{it.product_id}"
        stock = db.scalar(select(StkStock.qty).where(StkStock.product_id == it.product_id).limit(1)) or 0
        lack = stock < it.qty
        if lack:
            shortage += 1
        total_amount += float(it.qty) * float(it.price or 0)
        rows.append({"name": name, "qty": float(it.qty), "stock": float(stock), "lack": lack})
    risk_parts: list[str] = []
    if shortage:
        risk_parts.append(f"{shortage} 项材料库存不足")
    if freq >= 5:
        risk_parts.append(f"近30天领用 {freq} 次（偏高频）")
    if req.is_private:
        risk_parts.append("私用标记")
    risk_level = "高" if shortage else ("中" if req.is_private or freq >= 5 else "低")
    summary = (
        f"{applicant_name} 申请 {len(items)} 种材料共 {req.total_qty}（金额约 {total_amount:.2f}），"
        f"近30天领用 {freq} 次"
        + ("，其中 " + "、".join(risk_parts) if risk_parts else "")
    )
    fallback = {"summary": summary + "。", "risk_level": risk_level, "reasons": risk_parts, "ai": False}

    # ---- AI 润色 ----
    cfg_enabled = True
    from app.models.sys import SysConfig

    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ai.req_summary_enabled"))
    if cfg and cfg.config_value == "0":
        cfg_enabled = False
    if not cfg_enabled:
        return fallback
    data = (
        f"申请人：{applicant_name}（近30天领用 {freq} 次）\n"
        f"私用标记：{'是' if req.is_private else '否'}｜原因：{req.use_reason}｜地点：{req.use_location}\n"
        + "\n".join(
            f"- {r['name']}：申请 {r['qty']}，当前库存 {r['stock']}{'（不足！）' if r['lack'] else ''}" for r in rows
        )
    )
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return fallback
    try:
        content = llm.chat_text("只输出JSON，不要解释", SUMMARY_PROMPT + data, scene="req_summary")
        start, end = content.find("{"), content.rfind("}")
        obj = json.loads(content[start : end + 1]) if start >= 0 and end >= 0 else {}
        return {
            "summary": str(obj.get("summary") or fallback["summary"]),
            "risk_level": str(obj.get("risk_level") or fallback["risk_level"]),
            "reasons": list(obj.get("reasons") or fallback["reasons"]),
            "ai": True,
        }
    except (BizError, json.JSONDecodeError):
        return fallback
