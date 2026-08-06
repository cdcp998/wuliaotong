"""领用审核辅助摘要（P9-P1⑤，纯本地规则不用 LLM）：聚合领用单上下文
（明细/库存/近30天领用频率/私用标记/金额按进价估算）→ {summary, risk_level 低中高, reasons}。

确定性规则输出，免费即时；接入点：GET /requisitions/{id}/ai-summary（req:audit）。
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import BaseProduct
from app.models.requisition import OutRequisition, OutRequisitionItem
from app.models.stock import StkStock
from app.models.sys import SysUser


def ai_summary(db: Session, req: OutRequisition, items: list[OutRequisitionItem]) -> dict:
    """生成领用审核摘要（纯规则版）。"""
    applicant = db.get(SysUser, req.applicant_id)
    applicant_name = applicant.username if applicant else f"#{req.applicant_id}"
    since = datetime.now() - timedelta(days=30)
    freq = db.scalar(
        select(func.count(OutRequisition.id)).where(
            OutRequisition.applicant_id == req.applicant_id, OutRequisition.created_at >= since
        )
    ) or 0
    rows: list[dict] = []
    shortage = 0
    total_amount = 0.0
    for it in items:
        p = db.get(BaseProduct, it.product_id)
        name = p.name if p else f"#{it.product_id}"
        stock = db.scalar(select(StkStock.qty).where(StkStock.product_id == it.product_id).limit(1)) or 0
        lack = stock < it.qty
        if lack:
            shortage += 1
        if p and p.purchase_price:
            total_amount += float(it.qty) * float(p.purchase_price)
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
    return {"summary": summary + "。", "risk_level": risk_level, "reasons": risk_parts, "ai": False}
