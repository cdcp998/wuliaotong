"""报表 AI 月报摘要（P9-P1⑦）：服务端聚合经营数据（出入库/金额/TOP 材料/预警/异常/周期对比），
DeepSeek 生成 200-300 字经营摘要（LLM 不接触原始明细）；未配置/失败返回规则模板摘要。

接入点：POST /reports/ai-summary（report:view）。
"""
from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.response import BizError
from app.models.base import BaseProduct
from app.models.stock import PchPurchaseIn, PchPurchaseInItem, StkStock, StkStockLog
from app.models.sys import SysNotification
from app.services.llm import LLMNotConfigured, get_llm

SUMMARY_PROMPT = (
    "你是企业运营分析助手。根据以下经营数据，生成 200-300 字的中文月度经营摘要："
    "突出出入库总量与环比变化、TOP 材料、异常（负库存/呆滞/预警）、给出 1-2 条可执行建议。"
    "只输出摘要正文，不要解释、不要输出JSON。数据：\n"
)


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
    """生成指定日期范围经营摘要 {summary, ai}。"""
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

    data = (
        f"期间：{start} 至 {end}\n"
        f"入库件数：{_fmt(in_qty)}（上周期 {_fmt(prev_in)}，环比 {_pct(in_qty, prev_in)}）\n"
        f"出库件数：{_fmt(out_qty)}（上周期 {_fmt(prev_out)}，环比 {_pct(out_qty, prev_out)}）\n"
        f"采购入库金额：{_fmt(amount)}\n"
        f"TOP5 出库材料：{', '.join(top_out) if top_out else '无'}\n"
        f"TOP5 入库材料：{', '.join(top_in) if top_in else '无'}\n"
        f"预警通知数：{alerts}；负库存材料数：{neg_stock}；呆滞材料数（>90天无变动）：{stale}"
    )
    fallback = (
        f"{start} 至 {end} 入库 {_fmt(in_qty)} 件（环比 {_pct(in_qty, prev_in)}）、"
        f"出库 {_fmt(out_qty)} 件（环比 {_pct(out_qty, prev_out)}），"
        f"采购金额 {_fmt(amount)}；预警 {alerts} 条、负库存 {neg_stock} 项、呆滞 {stale} 项。"
    )

    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return {"summary": fallback, "ai": False}
    try:
        content = llm.chat_text("只输出摘要正文", SUMMARY_PROMPT + data, scene="report_summary")
    except BizError:
        return {"summary": fallback, "ai": False}
    text = content.strip()
    return {"summary": text[:800] or fallback, "ai": True}
