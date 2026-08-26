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

from app.core.cache import cache_delete_pattern
from app.core.response import BizError, E_NOT_FOUND, E_STOCK_NOT_ENOUGH
from app.models.base import BaseLocation, BaseProduct, BaseShelf, BaseWarehouse
from app.models.stock import StkStock, StkStockLog

_DEC2 = Decimal("0.01")
_DEC3 = Decimal("0.001")


def loc_display(db: Session, loc_id: int) -> str:
    """库位显示名：仓库名-货架编码-层号（如「一号仓-A01-01」）。

    界面统一用仓库名称展示，避免暴露 WH 仓库编码造成混淆；库位内部 code 不变。
    """
    loc = db.get(BaseLocation, loc_id)
    if loc is None:
        return ""
    wh = db.get(BaseWarehouse, loc.warehouse_id)
    shelf = db.get(BaseShelf, loc.shelf_id)
    return f"{wh.name if wh else ''}-{shelf.code if shelf else ''}-{loc.layer_no:02d}"


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
    allow_negative: bool = False,
) -> StkStockLog:
    """执行一笔库存变动（必须在调用方事务内）。qty_delta 正入负出。

    allow_negative=True 时允许出库后库存为负（领用流程：实物与系统账可能不符，
    库存不足先出库并提示管理员核对，由 audit 环节把关）。
    """
    if qty_delta == 0:
        raise BizError(4006, "变动数量不能为 0")
    if db.get(BaseProduct, product_id) is None:
        raise BizError(E_NOT_FOUND, "商品不存在")
    loc = db.get(BaseLocation, location_id)
    if loc is None:
        raise BizError(E_NOT_FOUND, "库位不存在")
    # 库位必须属于目标仓库：否则库存记录会挂在错误仓库下，导致仓库维度报表/查询不一致
    if loc.warehouse_id != warehouse_id:
        raise BizError(E_PARAM, f"库位 {loc.code} 不属于仓库 id={warehouse_id}")

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
    if qty_delta < 0 and before + qty_delta < 0 and not allow_negative:
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
        # 移动加权平均成本仅在回补后库存为正时重算：测试导入等无入库直接出库的数据
        # 库存行可能停在 -qty，回补后 after=0 会除零；after<=0 时成本无意义，
        # 保持原值即可（下次入库 old_qty*old_cost 项为 0，会自然重新起算）。
        if qty_delta > 0 and after > 0:
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
    # 库存已变动：看板聚合与货架图缓存失效（下个请求回源重建；即使事务回滚也仅是多余失效，安全）
    cache_delete_pattern("dash:*")
    cache_delete_pattern("stock:locsum:*")
    return log


def generate_bill_no(db: Session, prefix: str, model, field: str = "bill_no") -> str:
    """生成单据编号 {prefix}{yyyyMMdd}{4位流水}；调用方需在唯一键冲突时重试。

    field：编号字段名（默认 bill_no；任务单号等用 task_no）。
    """
    today = datetime.now().strftime("%Y%m%d")
    like = f"{prefix}{today}%"
    cnt = db.scalar(select(func.count()).select_from(model).where(getattr(model, field).like(like))) or 0
    return f"{prefix}{today}{cnt + 1:04d}"


def bill_no_conflict(exc: Exception) -> bool:
    """判断 IntegrityError 是否由单据号唯一键（uk_bill_no）冲突引起。

    并发撞号时重试换号；其余唯一/外键冲突必须如实报错，不能误吞。
    """
    orig = str(getattr(exc, "orig", None) or "")
    return "uk_bill_no" in orig or "bill_no" in orig
