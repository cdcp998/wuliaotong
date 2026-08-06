"""报表与看板接口（《后端API设计.md》§6 /stock/summary、§8 报表）。

报表全部基于 stk_stock_log 聚合（唯一事实来源）：
- 期初 = 期间起点前的累计净变动；入库 = change_qty>0 之和；出库 = |change_qty<0| 之和；结存 = 期初+入库-出库
- 预警判定与 scheduler.scan_stock_alerts 一致：min_stock/max_stock 非 0 才生效
"""
from __future__ import annotations

import io
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import BizError, E_PARAM, ok
from app.db import get_db
from app.models.advanced import StkCheck, StkTransfer
from app.models.base import BaseLocation, BaseProduct, BaseUnit, BaseWarehouse
from app.models.requisition import REQ_STATUS_PENDING, OutRequisition
from app.models.stock import StkStock, StkStockLog
from app.schemas.stock import PageData

router = APIRouter(tags=["报表"], dependencies=[Depends(get_current_user)])

_DEC2 = Decimal("0.01")
_DEC3 = Decimal("0.001")
_DEC0 = Decimal(0)


def _fmt_qty(v: Decimal | int | str | None) -> str:
    """数量统一格式化：保留至 3 位小数并去尾零（30.000 → 30，5.500 → 5.5）。"""
    d = Decimal(v or 0)
    return format(d.quantize(_DEC3), "f").rstrip("0").rstrip(".") or "0"
_EPOCH = datetime(2000, 1, 1)


def _parse_range(start: str, end: str) -> tuple[datetime, datetime]:
    """日期区间解析：缺省为 本月1号 00:00:00 ~ 今天 23:59:59。"""
    today = date.today()
    try:
        s = datetime.combine(date.fromisoformat(start), time.min) if start else datetime.combine(today.replace(day=1), time.min)
        e = datetime.combine(date.fromisoformat(end), time.max) if end else datetime.combine(today, time.max)
    except ValueError:
        raise BizError(E_PARAM, "日期格式错误，应为 YYYY-MM-DD")
    if s > e:
        raise BizError(E_PARAM, "开始日期不能晚于结束日期")
    return s, e


def _in_out_sum(db: Session, start: datetime | None, end: datetime | None, warehouse_id: int = 0) -> tuple[Decimal, Decimal]:
    """区间内入库件数（change_qty>0）与出库件数（|change_qty<0|）。"""
    stmt = select(
        func.coalesce(func.sum(case((StkStockLog.change_qty > 0, StkStockLog.change_qty), else_=0)), 0),
        func.coalesce(func.sum(case((StkStockLog.change_qty < 0, -StkStockLog.change_qty), else_=0)), 0),
    ).select_from(StkStockLog)
    if warehouse_id:
        stmt = stmt.where(StkStockLog.warehouse_id == warehouse_id)
    if start:
        stmt = stmt.where(StkStockLog.created_at >= start)
    if end:
        stmt = stmt.where(StkStockLog.created_at <= end)
    in_qty, out_qty = db.execute(stmt).one()
    return Decimal(in_qty or 0), Decimal(out_qty or 0)


def _alert_count(db: Session) -> int:
    """低于下限/高于上限的库存行数（口径同 scheduler）。"""
    return (
        db.scalar(
            select(func.count())
            .select_from(StkStock)
            .join(BaseProduct, BaseProduct.id == StkStock.product_id)
            .where(StkStock.qty != 0)
            .where(
                or_(
                    and_(BaseProduct.min_stock > 0, StkStock.qty < BaseProduct.min_stock),
                    and_(BaseProduct.max_stock > 0, StkStock.qty > BaseProduct.max_stock),
                )
            )
        )
        or 0
    )


def _trend_7d(db: Session) -> list[dict]:
    """近 7 日（含今天）每日入库/出库件数。"""
    start = datetime.combine(date.today() - timedelta(days=6), time.min)
    rows = db.execute(
        select(
            func.date(StkStockLog.created_at).label("d"),
            func.coalesce(func.sum(case((StkStockLog.change_qty > 0, StkStockLog.change_qty), else_=0)), 0),
            func.coalesce(func.sum(case((StkStockLog.change_qty < 0, -StkStockLog.change_qty), else_=0)), 0),
        )
        .where(StkStockLog.created_at >= start)
        .group_by(func.date(StkStockLog.created_at))
    ).all()
    m = {str(d): (Decimal(i or 0), Decimal(o or 0)) for d, i, o in rows}
    out = []
    for i in range(6, -1, -1):
        d = (date.today() - timedelta(days=i)).isoformat()
        in_qty, out_qty = m.get(d, (_DEC0, _DEC0))
        out.append({"date": d, "in_qty": _fmt_qty(in_qty), "out_qty": _fmt_qty(out_qty)})
    return out


def _pending_todos(db: Session) -> dict:
    """待办：领用待审计、调拨待审核、盘点进行中。"""
    return {
        "pending_requisitions": db.scalar(select(func.count()).select_from(OutRequisition).where(OutRequisition.status == REQ_STATUS_PENDING)) or 0,
        "pending_transfers": db.scalar(select(func.count()).select_from(StkTransfer).where(StkTransfer.status == 0)) or 0,
        "pending_checks": db.scalar(select(func.count()).select_from(StkCheck).where(StkCheck.status == 1)) or 0,
    }


@router.get("/stock/summary")
def stock_summary(db: Session = Depends(get_db)) -> dict:
    """看板：SKU 数、总件数、今日入库/出库件数、预警数、待审计单数、近 7 日趋势。"""
    today_start = datetime.combine(date.today(), time.min)
    today_in, today_out = _in_out_sum(db, today_start, None)
    return ok(
        {
            "sku_count": db.scalar(select(func.count(func.distinct(StkStock.product_id))).where(StkStock.qty != 0)) or 0,
            "total_qty": _fmt_qty(db.scalar(select(func.coalesce(func.sum(StkStock.qty), 0))) or 0),
            "today_in_qty": _fmt_qty(today_in),
            "today_out_qty": _fmt_qty(today_out),
            "alert_count": _alert_count(db),
            "pending_requisition_count": db.scalar(
                select(func.count()).select_from(OutRequisition).where(OutRequisition.status == REQ_STATUS_PENDING)
            )
            or 0,
            "trend_7d": _trend_7d(db),
        }
    )


@router.get("/reports/dashboard", dependencies=[Depends(require_permission("report:view"))])
def dashboard(db: Session = Depends(get_db)) -> dict:
    """经营看板：今日/本周/本月出入库、预警、待办、近 7 日趋势。"""
    now = datetime.now()
    today_start = datetime.combine(now.date(), time.min)
    week_start = today_start - timedelta(days=now.weekday())
    month_start = today_start.replace(day=1)
    today_in, today_out = _in_out_sum(db, today_start, None)
    week_in, week_out = _in_out_sum(db, week_start, None)
    month_in, month_out = _in_out_sum(db, month_start, None)
    return ok(
        {
            "today": {"in_qty": _fmt_qty(today_in), "out_qty": _fmt_qty(today_out)},
            "week": {"in_qty": _fmt_qty(week_in), "out_qty": _fmt_qty(week_out)},
            "month": {"in_qty": _fmt_qty(month_in), "out_qty": _fmt_qty(month_out)},
            "sku_count": db.scalar(select(func.count(func.distinct(StkStock.product_id))).where(StkStock.qty != 0)) or 0,
            "total_qty": _fmt_qty(db.scalar(select(func.coalesce(func.sum(StkStock.qty), 0))) or 0),
            "alert_count": _alert_count(db),
            "todos": _pending_todos(db),
            "trend_7d": _trend_7d(db),
        }
    )


def _inventory_rows(db: Session, start: datetime, end: datetime, warehouse_id: int = 0, product_id: int = 0) -> list[dict]:
    """期间进销存汇总（全量，供分页与导出复用）。按商品聚合：期初+入库-出库=结存。"""
    stmt = select(
        StkStockLog.product_id,
        StkStockLog.location_id,
        func.coalesce(func.sum(case((StkStockLog.created_at < start, StkStockLog.change_qty), else_=0)), 0),
        func.coalesce(
            func.sum(case((and_(StkStockLog.created_at >= start, StkStockLog.created_at <= end, StkStockLog.change_qty > 0), StkStockLog.change_qty), else_=0)),
            0,
        ),
        func.coalesce(
            func.sum(case((and_(StkStockLog.created_at >= start, StkStockLog.created_at <= end, StkStockLog.change_qty < 0), -StkStockLog.change_qty), else_=0)),
            0,
        ),
    ).select_from(StkStockLog)
    if warehouse_id:
        stmt = stmt.where(StkStockLog.warehouse_id == warehouse_id)
    if product_id:
        stmt = stmt.where(StkStockLog.product_id == product_id)
    rows = db.execute(stmt.group_by(StkStockLog.product_id, StkStockLog.location_id)).all()

    # 结存金额 = 各库位结存 × 该库位当前成本价（移动加权），避免跨库位成本混淆
    cost_map = {(s.product_id, s.location_id): Decimal(s.cost_price or 0) for s in db.scalars(select(StkStock)).all()}
    agg: dict[int, dict] = {}
    for pid, loc_id, opening, in_qty, out_qty in rows:
        opening = Decimal(opening or 0)
        in_qty = Decimal(in_qty or 0)
        out_qty = Decimal(out_qty or 0)
        closing = opening + in_qty - out_qty
        a = agg.setdefault(pid, {"opening": _DEC0, "in_qty": _DEC0, "out_qty": _DEC0, "closing": _DEC0, "amount": _DEC0})
        a["opening"] += opening
        a["in_qty"] += in_qty
        a["out_qty"] += out_qty
        a["closing"] += closing
        a["amount"] += closing * cost_map.get((pid, loc_id), _DEC0)
    return [
        {
            "product_id": pid,
            "opening_qty": _fmt_qty(a["opening"]),
            "in_qty": _fmt_qty(a["in_qty"]),
            "out_qty": _fmt_qty(a["out_qty"]),
            "closing_qty": _fmt_qty(a["closing"]),
            "closing_amount": str(a["amount"].quantize(_DEC2)),
        }
        for pid, a in sorted(agg.items())
    ]


@router.get("/reports/inventory-summary", dependencies=[Depends(require_permission("report:view"))])
def inventory_summary(
    warehouse_id: int = Query(0),
    product_id: int = Query(0),
    start: str = Query(""),
    end: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    s, e = _parse_range(start, end)
    rows = _inventory_rows(db, s, e, warehouse_id, product_id)
    total = len(rows)
    page_rows = rows[(page - 1) * page_size : page * page_size]
    out = []
    for r in page_rows:
        p = db.get(BaseProduct, r["product_id"])
        unit = db.get(BaseUnit, p.unit_id) if p else None
        out.append(
            {
                **r,
                "code": p.code if p else "",
                "name": p.name if p else "",
                "spec": p.spec if p else "",
                "unit_name": unit.name if unit else "",
            }
        )
    return ok(PageData(list=out, total=total, page=page, page_size=page_size).model_dump())


def _stock_rows(db: Session, warehouse_id: int, sort: str) -> list[dict]:
    """库存余额全量（供分页与导出复用）：qty/amount/turnover 排序，含 30 天出库与呆滞天数。"""
    out30 = (
        select(StkStockLog.product_id, func.sum(-StkStockLog.change_qty).label("out30"))
        .where(StkStockLog.change_qty < 0, StkStockLog.created_at >= datetime.now() - timedelta(days=30))
        .group_by(StkStockLog.product_id)
        .subquery()
    )
    last = (
        select(StkStockLog.product_id, func.max(StkStockLog.created_at).label("last"))
        .group_by(StkStockLog.product_id)
        .subquery()
    )
    stmt = (
        select(StkStock, func.coalesce(out30.c.out30, 0).label("out30"), func.coalesce(last.c.last, _EPOCH).label("last"))
        .join(out30, out30.c.product_id == StkStock.product_id, isouter=True)
        .join(last, last.c.product_id == StkStock.product_id, isouter=True)
        .where(StkStock.qty > 0)
    )
    if warehouse_id:
        stmt = stmt.where(StkStock.warehouse_id == warehouse_id)
    if sort == "qty":
        stmt = stmt.order_by(StkStock.qty.desc())
    elif sort == "amount":
        stmt = stmt.order_by((StkStock.qty * StkStock.cost_price).desc())
    else:  # turnover：30 天出库多优先，久未变动靠前
        stmt = stmt.order_by(func.coalesce(out30.c.out30, 0).desc(), func.coalesce(last.c.last, _EPOCH).asc())
    now = datetime.now()
    out = []
    for stock, out30_qty, last_moved in db.execute(stmt).all():
        p = db.get(BaseProduct, stock.product_id)
        wh = db.get(BaseWarehouse, stock.warehouse_id)
        # 兼容驱动返回 str / datetime / None（coalesce 兜底 _EPOCH 可能改变列类型）
        if isinstance(last_moved, datetime):
            last_dt: datetime | None = last_moved
        elif last_moved:
            last_dt = datetime.fromisoformat(str(last_moved).replace(" ", "T"))
        else:
            last_dt = None
        days = (now - last_dt).days if last_dt else 9999
        out.append(
            {
                "product_id": stock.product_id,
                "code": p.code if p else "",
                "name": p.name if p else "",
                "spec": p.spec if p else "",
                "warehouse_name": wh.name if wh else "",
                "qty": _fmt_qty(stock.qty),
                "cost_price": str(stock.cost_price),
                "amount": str((stock.qty * stock.cost_price).quantize(_DEC2)),
                "out_qty_30d": _fmt_qty(out30_qty),
                "last_moved_at": last_dt.strftime("%Y-%m-%d %H:%M:%S") if last_dt else "",
                "dormant_days": days,
            }
        )
    return out


@router.get("/reports/stock", dependencies=[Depends(require_permission("report:view"))])
def stock_report(
    warehouse_id: int = Query(0),
    sort: str = Query("qty"),  # qty | amount | turnover
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    """库存余额/周转/呆滞。"""
    if sort not in ("qty", "amount", "turnover"):
        raise BizError(E_PARAM, "sort 仅支持 qty|amount|turnover")
    rows = _stock_rows(db, warehouse_id, sort)
    total = len(rows)
    page_rows = rows[(page - 1) * page_size : page * page_size]
    return ok(PageData(list=page_rows, total=total, page=page, page_size=page_size).model_dump())


def _export_xlsx(headers: list[str], data: list[list], filename: str) -> StreamingResponse:
    wb = Workbook()
    ws = wb.active
    ws.title = "报表"
    ws.append(headers)
    for r in data:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/reports/export", dependencies=[Depends(require_permission("report:export"))])
def export_report(
    type: str = Query("inventory-summary"),  # inventory-summary | stock | flow
    warehouse_id: int = Query(0),
    start: str = Query(""),
    end: str = Query(""),
    sort: str = Query("qty"),
    product_id: int = Query(0),
    bill_no: str = Query("", max_length=30),
    change_type: str = Query("", max_length=20),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    today = date.today().isoformat().replace("-", "")
    if type == "inventory-summary":
        s, e = _parse_range(start, end)
        data = []
        for r in _inventory_rows(db, s, e, warehouse_id, product_id):
            p = db.get(BaseProduct, r["product_id"])
            unit = db.get(BaseUnit, p.unit_id) if p else None
            data.append(
                [
                    p.code if p else "",
                    p.name if p else "",
                    p.spec if p else "",
                    unit.name if unit else "",
                    r["opening_qty"],
                    r["in_qty"],
                    r["out_qty"],
                    r["closing_qty"],
                    r["closing_amount"],
                ]
            )
        return _export_xlsx(
            ["商品编码", "商品名称", "规格", "单位", "期初数量", "入库数量", "出库数量", "结存数量", "结存金额"],
            data,
            f"inventory-summary_{today}.xlsx",
        )
    if type == "stock":
        if sort not in ("qty", "amount", "turnover"):
            raise BizError(E_PARAM, "sort 仅支持 qty|amount|turnover")
        data = [
            [
                r["code"], r["name"], r["spec"], r["warehouse_name"], r["qty"],
                r["cost_price"], r["amount"], r["out_qty_30d"], r["last_moved_at"], r["dormant_days"],
            ]
            for r in _stock_rows(db, warehouse_id, sort)
        ]
        return _export_xlsx(
            ["商品编码", "商品名称", "规格", "仓库", "数量", "成本价", "金额", "30天出库", "最近变动", "呆滞天数"],
            data,
            f"stock_{today}.xlsx",
        )
    if type == "flow":
        stmt = select(StkStockLog)
        if product_id:
            stmt = stmt.where(StkStockLog.product_id == product_id)
        if bill_no:
            stmt = stmt.where(StkStockLog.bill_no.like(f"%{bill_no}%"))
        if change_type:
            stmt = stmt.where(StkStockLog.change_type == change_type)
        if start:
            stmt = stmt.where(StkStockLog.created_at >= f"{start} 00:00:00")
        if end:
            stmt = stmt.where(StkStockLog.created_at <= f"{end} 23:59:59")
        rows = db.scalars(stmt.order_by(StkStockLog.id.desc())).all()
        data = []
        for log in rows:
            p = db.get(BaseProduct, log.product_id)
            wh = db.get(BaseWarehouse, log.warehouse_id)
            loc = db.get(BaseLocation, log.location_id)
            data.append(
                [
                    log.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                    p.code if p else "",
                    p.name if p else "",
                    wh.name if wh else "",
                    loc.code if loc else "",
                    log.change_type,
                    log.bill_no,
                    str(log.before_qty),
                    str(log.change_qty),
                    str(log.after_qty),
                    str(log.cost_price),
                    log.remark,
                ]
            )
        return _export_xlsx(
            ["时间", "商品编码", "商品名称", "仓库", "库位", "类型", "单据号", "变动前", "变动数量", "变动后", "成本价", "备注"],
            data,
            f"flow_{today}.xlsx",
        )
    raise BizError(E_PARAM, "type 仅支持 inventory-summary|stock|flow")
