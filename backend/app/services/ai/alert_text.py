"""库存预警通知正文（P9-P0④，纯本地规则不用 LLM）：规则聚合上下文
（材料/库存/上下限/近30天出库量/最近采购价）拼接为可读正文——免费、确定、毫秒级。

接入点：app/scheduler.py scan_stock_alerts 每条预警生成时调用。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import BaseProduct
from app.models.stock import PchPurchaseInItem, StkStockLog

_TEMPLATE_FALLBACK = "，请及时处理。"


def _fmt(v: Decimal) -> str:
    return format(v, "f")


def generate_alert_text(db: Session, *, product: BaseProduct, qty: Decimal, kind: str) -> str:
    """生成单条预警通知正文（kind: 低库存/高库存），规则拼接不调大模型。"""
    min_s = _fmt(product.min_stock) if product.min_stock else "-"
    max_s = _fmt(product.max_stock) if product.max_stock else "-"
    base = f"{product.name}（{product.code}）库存 {_fmt(qty)}，"
    base += f"低于下限 {min_s}" if kind == "低库存" else f"高于上限 {max_s}"

    # 近 30 天出库量（负变动流水）
    since = datetime.now() - timedelta(days=30)
    out_qty = db.scalar(
        select(func.coalesce(func.sum(StkStockLog.change_qty), 0)).where(
            StkStockLog.product_id == product.id,
            StkStockLog.change_qty < 0,
            StkStockLog.created_at >= since,
        )
    ) or Decimal(0)
    # 最近采购价
    price_row = db.scalar(
        select(PchPurchaseInItem.price)
        .where(PchPurchaseInItem.product_id == product.id, PchPurchaseInItem.price > 0)
        .order_by(PchPurchaseInItem.id.desc())
        .limit(1)
    )

    text = f"{base}。近30天出库 {_fmt(abs(out_qty))}"
    if price_row:
        text += f"，参考采购价 {_fmt(price_row)}"
    text += _TEMPLATE_FALLBACK
    return text[:300]  # 通知 content 上限 500，留余量
