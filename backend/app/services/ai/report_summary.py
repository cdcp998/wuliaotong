"""报表月报摘要（P9-P1⑦，纯本地规则不用 LLM）：服务端聚合经营数据
（出入库件数与上周期环比、采购金额、TOP5 出入库材料、预警/负库存/呆滞），
规则拼接生成摘要与建议——免费、确定、毫秒级。

接入点：POST /reports/ai-summary（report:view）。
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.base import BaseProduct
from app.models.stock import PchPurchaseIn, PchPurchaseInItem, StkStock, StkStockLog
from app.models.sys import SysNotification


def _fmt(v) -> str:
    return format(v, "f") if isinstance(v, Decimal) else str(v)


def _in_out_qty(db: Session, start: datetime, end: datetime | None) -> tuple[Decimal, Decimal]:
    # MySQL 5.7 不支持 FILTER 聚合 → 用 case when
    stmt = select(
        func.coalesce(func.sum(case((StkStockLog.change_qty > 0, StkStockLog.change_qty), else_=0)), 0),
        func.coalesce(func.sum(case((StkStockLog.change_qty < 0, -StkStockLog.change_qty), else_=0)), 0),
    ).where(StkStockLog.created_at >= start)
    if end:
        stmt = stmt.where(StkStockLog.created_at < end)
    row = db.execute(stmt).one()
    return Decimal(row[0] or 0), Decimal(row[1] or 0)


def _top_materials(db: Session, start: datetime, end: datetime | None, desc: bool, limit: int = 5) -> list[str]:
    """TOP 出入库材料（desc=True 出库，False 入库）。"""
    sign = -1 if desc else 1
    stmt = (
        select(BaseProduct.name, func.sum(StkStockLog.change_qty))
        .join(StkStockLog, StkStockLog.product_id == BaseProduct.id)
        .where(StkStockLog.change_qty * sign > 0, StkStockLog.created_at >= start)
        .group_by(BaseProduct.id)
        .order_by(func.sum(StkStockLog.change_qty).desc())
        .limit(limit)
    )
    if end:
        stmt = stmt.where(StkStockLog.created_at < end)
    return [f"{name}({_fmt(abs(qty))})" for name, qty in db.execute(stmt).all()]


def _purchase_amount(db: Session, start: datetime, end: datetime | None) -> Decimal:
    stmt = (
        select(func.coalesce(func.sum(PchPurchaseInItem.amount), 0))
        .join(PchPurchaseIn, PchPurchaseIn.id == PchPurchaseInItem.bill_id)
        .where(PchPurchaseIn.bill_date >= start, PchPurchaseIn.status == 1)
    )
    if end:
        stmt = stmt.where(PchPurchaseIn.bill_date < end)
    return Decimal(db.scalar(stmt) or 0)


def report_summary(db: Session, start: date, end: date) -> dict:
    """生成指定日期范围经营摘要 {summary, ai: false}（纯规则，不调大模型）。"""
    start_dt = datetime.combine(start, time.min)
    end_dt = datetime.combine(end, time.max) + timedelta(microseconds=1)
    period_days = max((end - start).days + 1, 1)
    prev_start_dt = start_dt - timedelta(days=period_days)

    in_qty, out_qty = _in_out_qty(db, start_dt, end_dt)
    prev_in, prev_out = _in_out_qty(db, prev_start_dt, start_dt)
    amount = _purchase_amount(db, start_dt, end_dt)
    top_out = _top_materials(db, start_dt, end_dt, desc=True)
    top_in = _top_materials(db, start_dt, end_dt, desc=False)
    neg_stock = db.scalar(select(func.count(StkStock.id)).where(StkStock.qty < 0)) or 0
    # 呆滞：有库存但最近 90 天无任何流水
    stale_cut = datetime.now() - timedelta(days=90)
    stale = db.scalar(
        select(func.count(StkStock.id)).where(
            StkStock.qty > 0,
            ~StkStock.product_id.in_(
                select(StkStockLog.product_id).where(StkStockLog.created_at >= stale_cut)
            ),
        )
    ) or 0
    alerts = db.scalar(
        select(func.count(SysNotification.id)).where(
            SysNotification.biz_type == "预警",
            SysNotification.created_at >= start_dt,
            SysNotification.created_at < end_dt,
        )
    ) or 0

    def _pct(cur, prev):
        return f"{round((float(cur) - float(prev)) / float(prev) * 100, 1)}%" if prev else "—"

    # ---- 规则拼接摘要 ----
    parts = [
        f"{start} 至 {end}：入库 {_fmt(in_qty)} 件（环比 {_pct(in_qty, prev_in)}），"
        f"出库 {_fmt(out_qty)} 件（环比 {_pct(out_qty, prev_out)}），采购金额 {_fmt(amount)}。"
    ]
    if top_out:
        parts.append(f"出库 TOP5：{'、'.join(top_out)}。")
    if top_in:
        parts.append(f"入库 TOP5：{'、'.join(top_in)}。")
    if alerts or neg_stock or stale:
        parts.append(f"异常：预警 {alerts} 条、负库存 {neg_stock} 项、呆滞（>90天无变动）{stale} 项。")
    # 规则建议（模板化）
    suggestions: list[str] = []
    if neg_stock:
        suggestions.append(f"存在 {neg_stock} 项负库存，建议核查产生原因并完善出入库/盘点流程")
    if stale:
        suggestions.append(f"存在 {stale} 项呆滞材料（>90天无变动），建议评估处置（降库存/报废）")
    if alerts >= 10:
        suggestions.append(f"预警 {alerts} 条偏多，建议调整相关材料安全库存阈值")
    if prev_out and float(out_qty) < float(prev_out) * 0.8:
        suggestions.append("出库量较上周期下降超 20%，建议关注需求变化")
    if suggestions:
        parts.append("建议：" + "；".join(suggestions) + "。")
    return {"summary": "".join(parts), "ai": False}
