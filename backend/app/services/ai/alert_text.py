"""库存预警通知智能生成（P9-④）：规则聚合上下文（库存/上下限/近30天消耗/采购价）
+ DeepSeek 生成带建议的正文；AI 不可用/失败/开关关闭时降级为规则模板文案。

开关：sys_config ai.alert_enabled（默认 1，设置 0 关闭走模板）。
接入点：app/scheduler.py scan_stock_alerts 每条预警生成时调用。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.response import BizError
from app.models.base import BaseProduct
from app.models.stock import PchPurchaseInItem, StkStockLog
from app.models.sys import SysConfig
from app.services.llm import LLMNotConfigured, get_llm

ALERT_PROMPT = (
    "你是仓库管理助手。根据以下库存预警数据，生成一段不超过80字的中文预警通知正文："
    "包含材料名称、当前库存、上下限、近30天消耗趋势、建议补货量（按消耗估算）与优先级（紧急/一般）。"
    "只输出正文，不要解释。数据：\n"
)

_TEMPLATE_FALLBACK = "，请及时处理。"


def _fmt(v: Decimal) -> str:
    return format(v, "f")


def generate_alert_text(db: Session, *, product: BaseProduct, qty: Decimal, kind: str) -> str:
    """生成单条预警通知正文（kind: 低库存/高库存）；AI 不可用时返回规则模板文案。"""
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

    fallback = f"{base}。近30天出库 {_fmt(abs(out_qty))}"
    if price_row:
        fallback += f"，参考采购价 {_fmt(price_row)}"
    fallback += _TEMPLATE_FALLBACK

    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ai.alert_enabled"))
    if cfg and cfg.config_value == "0":
        return fallback
    data = (
        f"材料：{product.name}（编码 {product.code}）\n"
        f"库存：{_fmt(qty)}，下限 {min_s}，上限 {max_s}\n"
        f"近30天出库：{_fmt(abs(out_qty))}\n"
        f"最近采购价：{_fmt(price_row) if price_row else '无记录'}"
    )
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return fallback
    try:
        content = llm.chat_text("只输出通知正文，不要解释", ALERT_PROMPT + data, scene="alert_text")
    except BizError:
        return fallback
    text = " ".join(content.split())
    return text[:300] or fallback  # 通知 content 上限 500，留余量
