"""库存事务服务（《开发规范.md》§4.5 铁律、API 设计 §11.1）。

一切库存变动必须调用 `post_stock_change()`：
行锁（SELECT ... FOR UPDATE）→ 库存校验 → 写流水 → 更新实时库存（移动加权成本），
与单据状态更新在同一数据库事务内提交。禁止在路由/其他服务里直接改 stk_stock。
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.response import BizError, E_NOT_FOUND, E_STOCK_NOT_ENOUGH
from app.models.base import BaseLocation, BaseProduct
from app.models.stock import StkStock, StkStockLog

_DEC2 = Decimal("0.01")
_DEC3 = Decimal("0.001")


def post_stock_change(
    db: Session,
    *,
    product_id: int,
    warehouse_id: int,
    location_id: int,
    change_type: str,
    bill_type: str,
    bill_no: str,
    bill_item_id: int = 0,
    qty_delta: Decimal,
    cost_price: Decimal = Decimal(0),
    photo_file_id: int = 0,
    operator_id: int = 0,
    remark: str = "",
) -> StkStockLog:
    """执行一笔库存变动（必须在调用方事务内）。qty_delta 正入负出，出库校验库存充足。"""
    if qty_delta == 0:
        raise BizError(4006, "变动数量不能为 0")
    if db.get(BaseProduct, product_id) is None:
        raise BizError(E_NOT_FOUND, "商品不存在")
    if db.get(BaseLocation, location_id) is None:
        raise BizError(E_NOT_FOUND, "库位不存在")

    stock = db.scalar(
        select(StkStock)
        .where(
            StkStock.product_id == product_id,
            StkStock.warehouse_id == warehouse_id,
            StkStock.location_id == location_id,
        )
        .with_for_update()  # 行锁：防并发超卖/超领
    )
    before = stock.qty if stock else Decimal(0)
    if qty_delta < 0 and before + qty_delta < 0:
        raise BizError(E_STOCK_NOT_ENOUGH, f"库存不足：当前 {format(before, 'f')}，需出库 {format(-qty_delta, 'f')}")

    after = (before + qty_delta).quantize(_DEC3)
    if stock is None:
        stock = StkStock(
            product_id=product_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            qty=after,
            cost_price=cost_price if qty_delta > 0 else Decimal(0),
        )
        db.add(stock)
    else:
        if qty_delta > 0:
            # 移动加权平均成本：new = (old_qty*old_cost + in_qty*in_price) / new_qty
            total = stock.cost_price * before + cost_price * qty_delta
            stock.cost_price = (total / after).quantize(_DEC2, rounding=ROUND_HALF_UP)
        stock.qty = after

    log = StkStockLog(
        product_id=product_id,
        warehouse_id=warehouse_id,
        location_id=location_id,
        change_type=change_type,
        bill_type=bill_type,
        bill_no=bill_no,
        bill_item_id=bill_item_id,
        before_qty=before,
        change_qty=qty_delta,
        after_qty=after,
        # 出库按当前成本结转，入库按本次进价
        cost_price=stock.cost_price if qty_delta < 0 else cost_price,
        photo_file_id=photo_file_id,
        operator_id=operator_id,
        remark=remark,
    )
    db.add(log)
    return log


def generate_bill_no(db: Session, prefix: str, model) -> str:
    """生成单据编号 {prefix}{yyyyMMdd}{4位流水}；调用方需在唯一键冲突时重试。"""
    today = datetime.now().strftime("%Y%m%d")
    like = f"{prefix}{today}%"
    cnt = db.scalar(select(func.count()).select_from(model).where(model.bill_no.like(like))) or 0
    return f"{prefix}{today}{cnt + 1:04d}"
