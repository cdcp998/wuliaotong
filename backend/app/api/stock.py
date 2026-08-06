"""库存接口：采购入库/期初库存/库存查询/流水（《后端API设计.md》§3、§6）。

库存一致性：所有入库/作废/期初过账必须走 services/stock.py 的 post_stock_change()，
与单据状态更新在同一事务提交（《开发规范.md》§4.5）。
"""
from __future__ import annotations

import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import BizError, E_BILL_STATUS, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.base import BaseLocation, BaseProduct, BaseSupplier, BaseUnit, BaseWarehouse
from app.models.stock import (
    PchPurchaseIn,
    PchPurchaseInItem,
    StkOpening,
    StkOpeningItem,
    StkStock,
    StkStockLog,
)
from app.models.sys import SysUser
from app.schemas.stock import (
    OpeningItemOut,
    OpeningOut,
    OpeningReq,
    PageData,
    PurchaseInItemOut,
    PurchaseInOut,
    PurchaseInReq,
    StockFlowRow,
    StockRow,
)
from app.services.stock import generate_bill_no, post_stock_change

router = APIRouter(tags=["库存"], dependencies=[Depends(get_current_user)])

_DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")
_DEC2 = Decimal("0.01")
_DEC3 = Decimal("0.001")
_OPENING_IMPORT_COLUMNS = ["商品编码", "库位编码", "数量", "成本价"]


def _fmt_qty(v: Decimal | int | str | None) -> str:
    """数量统一格式化：保留至 3 位小数并去尾零（30.000 → 30，5.500 → 5.5）。"""
    d = Decimal(v or 0)
    return format(d.quantize(_DEC3), "f").rstrip("0").rstrip(".") or "0"


def _parse_dec(v: str, field: str) -> Decimal:
    if not _DECIMAL_RE.match(v):
        raise BizError(E_PARAM, f"{field} 必须是数字")
    return Decimal(v)


def _user_name(db: Session, uid: int) -> str:
    u = db.get(SysUser, uid)
    return u.real_name if u else ""


def _loc_code(db: Session, loc_id: int) -> str:
    loc = db.get(BaseLocation, loc_id)
    return loc.code if loc else ""


def _purchase_out(db: Session, bill: PchPurchaseIn) -> dict:
    items = db.scalars(select(PchPurchaseInItem).where(PchPurchaseInItem.bill_id == bill.id).order_by(PchPurchaseInItem.sort)).all()
    wh = db.get(BaseWarehouse, bill.warehouse_id)
    sup = db.get(BaseSupplier, bill.supplier_id)
    return PurchaseInOut(
        id=bill.id, bill_no=bill.bill_no, supplier_id=bill.supplier_id,
        supplier_name=sup.name if sup else "",
        warehouse_id=bill.warehouse_id, warehouse_name=wh.name if wh else "",
        total_qty=bill.total_qty, total_amount=bill.total_amount, status=bill.status,
        bill_date=bill.bill_date, operator_name=_user_name(db, bill.operator_id), remark=bill.remark,
        items=[
            PurchaseInItemOut(
                id=it.id, product_id=it.product_id,
                product_name=(p.name if (p := db.get(BaseProduct, it.product_id)) else ""),
                code=(p.code if (p := db.get(BaseProduct, it.product_id)) else ""),
                qty=it.qty, unit_name=it.unit_name, price=it.price, amount=it.amount,
                location_id=it.location_id, location_code=_loc_code(db, it.location_id),
            )
            for it in items
        ],
    ).model_dump()


# ============================ 采购入库 ============================


@router.post("/purchase-in", dependencies=[Depends(require_permission("pch:in"))])
def create_purchase_in(
    req: PurchaseInReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(BaseWarehouse, req.warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    for attempt in range(5):  # 单号并发冲突重试
        bill_no = generate_bill_no(db, "RK", PchPurchaseIn)
        bill = PchPurchaseIn(
            bill_no=bill_no, supplier_id=req.supplier_id, warehouse_id=req.warehouse_id,
            status=1, bill_date=req.bill_date or datetime.now(), operator_id=user.id, remark=req.remark,
        )
        db.add(bill)
        db.flush()
        total_qty, total_amount = Decimal(0), Decimal(0)
        try:
            for idx, item in enumerate(req.items):
                product = db.get(BaseProduct, item.product_id)
                if product is None:
                    raise BizError(E_NOT_FOUND, f"商品 id={item.product_id} 不存在")
                if db.get(BaseLocation, item.location_id) is None:
                    raise BizError(E_NOT_FOUND, f"库位 id={item.location_id} 不存在")
                qty = _parse_dec(item.qty, "数量")
                price = _parse_dec(item.price, "进价")
                if qty <= 0:
                    raise BizError(E_PARAM, "数量必须大于 0")
                amount = (qty * price).quantize(_DEC2)
                unit_name = item.unit_name or (db.get(BaseUnit, product.unit_id).name if product.unit_id else "")
                item_row = PchPurchaseInItem(
                    bill_id=bill.id, product_id=product.id, qty=qty, unit_name=unit_name,
                    price=price, amount=amount, location_id=item.location_id,
                    photo_file_id=item.photo_file_id, sort=idx,
                )
                db.add(item_row)
                db.flush()
                post_stock_change(
                    db,
                    product_id=product.id, warehouse_id=req.warehouse_id, location_id=item.location_id,
                    change_type="采购入库", bill_type="pch_purchase_in", bill_no=bill_no,
                    bill_item_id=item_row.id, qty_delta=qty, cost_price=price,
                    photo_file_id=item.photo_file_id, operator_id=user.id,
                )
                total_qty += qty
                total_amount += amount
            bill.total_qty = total_qty.quantize(Decimal("0.001"))
            bill.total_amount = total_amount.quantize(_DEC2)
            db.commit()
            return ok({"id": bill.id, "bill_no": bill_no})
        except IntegrityError:
            db.rollback()
            continue  # 单号冲突，换号重试
    raise BizError(E_PARAM, "单据编号生成失败，请重试")


@router.get("/purchase-in")
def list_purchase_in(
    bill_no: str = Query("", max_length=30),
    supplier_id: int = Query(0),
    warehouse_id: int = Query(0),
    start: str = Query(""),
    end: str = Query(""),
    status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(PchPurchaseIn)
    if bill_no:
        stmt = stmt.where(PchPurchaseIn.bill_no.like(f"%{bill_no}%"))
    if supplier_id:
        stmt = stmt.where(PchPurchaseIn.supplier_id == supplier_id)
    if warehouse_id:
        stmt = stmt.where(PchPurchaseIn.warehouse_id == warehouse_id)
    if start:
        stmt = stmt.where(PchPurchaseIn.bill_date >= f"{start} 00:00:00")
    if end:
        stmt = stmt.where(PchPurchaseIn.bill_date <= f"{end} 23:59:59")
    if status is not None:
        stmt = stmt.where(PchPurchaseIn.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(PchPurchaseIn.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(
        list=[_purchase_out(db, b) for b in rows],
        total=total, page=page, page_size=page_size,
    ).model_dump())


@router.get("/purchase-in/{bill_id}")
def get_purchase_in(bill_id: int, db: Session = Depends(get_db)) -> dict:
    bill = db.get(PchPurchaseIn, bill_id)
    if bill is None:
        raise BizError(E_NOT_FOUND, "入库单不存在")
    return ok(_purchase_out(db, bill))


@router.post("/purchase-in/{bill_id}/void", dependencies=[Depends(require_permission("pch:in"))])
def void_purchase_in(
    bill_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    bill = db.get(PchPurchaseIn, bill_id)
    if bill is None:
        raise BizError(E_NOT_FOUND, "入库单不存在")
    if bill.status != 1:
        raise BizError(E_BILL_STATUS, "仅已入库单据可作废")
    if bill.bill_date.date() != datetime.now().date():
        raise BizError(E_BILL_STATUS, "仅当日单据可作废")
    bill.status = -1
    items = db.scalars(select(PchPurchaseInItem).where(PchPurchaseInItem.bill_id == bill.id)).all()
    for it in items:
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=bill.warehouse_id, location_id=it.location_id,
            change_type="采购入库作废", bill_type="pch_purchase_in", bill_no=bill.bill_no,
            bill_item_id=it.id, qty_delta=-it.qty, cost_price=it.price,
            operator_id=user.id, remark="作废冲销",
        )
    db.commit()
    return ok()


# ============================ 期初库存 ============================


def _opening_out(db: Session, bill: StkOpening) -> dict:
    items = db.scalars(select(StkOpeningItem).where(StkOpeningItem.bill_id == bill.id)).all()
    wh = db.get(BaseWarehouse, bill.warehouse_id)
    return OpeningOut(
        id=bill.id, bill_no=bill.bill_no, warehouse_id=bill.warehouse_id,
        warehouse_name=wh.name if wh else "", status=bill.status, remark=bill.remark,
        creator_name=_user_name(db, bill.creator_id),
        items=[
            OpeningItemOut(
                id=it.id, product_id=it.product_id,
                product_name=(p.name if (p := db.get(BaseProduct, it.product_id)) else ""),
                code=(p.code if (p := db.get(BaseProduct, it.product_id)) else ""),
                location_id=it.location_id, location_code=_loc_code(db, it.location_id),
                qty=it.qty, cost_price=it.cost_price,
            ).model_dump()
            for it in items
        ],
    ).model_dump()


@router.post("/opening", dependencies=[Depends(require_permission("pch:in"))])
def create_opening(
    req: OpeningReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(BaseWarehouse, req.warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    bill_no = generate_bill_no(db, "QCK", StkOpening)
    bill = StkOpening(bill_no=bill_no, warehouse_id=req.warehouse_id, status=0, remark=req.remark, creator_id=user.id)
    db.add(bill)
    db.flush()
    for idx, item in enumerate(req.items):
        if db.get(BaseProduct, item.product_id) is None:
            raise BizError(E_NOT_FOUND, f"商品 id={item.product_id} 不存在")
        if db.get(BaseLocation, item.location_id) is None:
            raise BizError(E_NOT_FOUND, f"库位 id={item.location_id} 不存在")
        db.add(StkOpeningItem(
            bill_id=bill.id, product_id=item.product_id, location_id=item.location_id,
            qty=_parse_dec(item.qty, "数量"), cost_price=_parse_dec(item.cost_price, "成本价"),
        ))
    db.commit()
    return ok({"id": bill.id, "bill_no": bill_no})


@router.get("/opening")
def list_opening(
    status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(StkOpening)
    if status is not None:
        stmt = stmt.where(StkOpening.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(StkOpening.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[_opening_out(db, b) for b in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/opening/{bill_id}")
def get_opening(bill_id: int, db: Session = Depends(get_db)) -> dict:
    bill = db.get(StkOpening, bill_id)
    if bill is None:
        raise BizError(E_NOT_FOUND, "期初单不存在")
    return ok(_opening_out(db, bill))


@router.put("/opening/{bill_id}", dependencies=[Depends(require_permission("pch:in"))])
def update_opening(bill_id: int, req: OpeningReq, db: Session = Depends(get_db)) -> dict:
    bill = db.get(StkOpening, bill_id)
    if bill is None:
        raise BizError(E_NOT_FOUND, "期初单不存在")
    if bill.status != 0:
        raise BizError(E_BILL_STATUS, "仅草稿可修改")
    bill.warehouse_id = req.warehouse_id
    bill.remark = req.remark
    db.execute(StkOpeningItem.__table__.delete().where(StkOpeningItem.bill_id == bill.id))
    for item in req.items:
        if db.get(BaseProduct, item.product_id) is None:
            raise BizError(E_NOT_FOUND, f"商品 id={item.product_id} 不存在")
        db.add(StkOpeningItem(
            bill_id=bill.id, product_id=item.product_id, location_id=item.location_id,
            qty=_parse_dec(item.qty, "数量"), cost_price=_parse_dec(item.cost_price, "成本价"),
        ))
    db.commit()
    return ok()


@router.post("/opening/{bill_id}/post", dependencies=[Depends(require_permission("pch:in"))])
def post_opening(
    bill_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    bill = db.get(StkOpening, bill_id)
    if bill is None:
        raise BizError(E_NOT_FOUND, "期初单不存在")
    if bill.status != 0:
        raise BizError(E_BILL_STATUS, "仅草稿可过账")
    items = db.scalars(select(StkOpeningItem).where(StkOpeningItem.bill_id == bill.id)).all()
    if not items:
        raise BizError(E_PARAM, "期初单明细为空")
    bill.status = 1
    for it in items:
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=bill.warehouse_id, location_id=it.location_id,
            change_type="期初", bill_type="stk_opening", bill_no=bill.bill_no,
            bill_item_id=it.id, qty_delta=it.qty, cost_price=it.cost_price,
            operator_id=user.id,
        )
    db.commit()
    return ok()


@router.post("/opening/import", dependencies=[Depends(require_permission("pch:in"))])
async def import_opening(
    warehouse_id: int = Query(..., gt=0),
    file: UploadFile = File(...),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Excel 导入期初明细（表头：商品编码/库位编码/数量/成本价），生成草稿。"""
    if db.get(BaseWarehouse, warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    data = await file.read()
    wb = load_workbook(io.BytesIO(data), read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise BizError(E_PARAM, "文件为空")
    headers = [str(h).strip() if h else "" for h in rows[0]]
    if headers[:4] != _OPENING_IMPORT_COLUMNS:
        raise BizError(E_PARAM, f"表头必须为：{'/'.join(_OPENING_IMPORT_COLUMNS)}")

    bill = StkOpening(bill_no=generate_bill_no(db, "QCK", StkOpening), warehouse_id=warehouse_id, status=0, creator_id=user.id)
    db.add(bill)
    db.flush()
    success, fail_rows = 0, []
    for idx, row in enumerate(rows[1:], start=2):
        vals = [str(v).strip() if v is not None else "" for v in row] + [""] * 4
        product = db.scalar(select(BaseProduct).where(BaseProduct.code == vals[0])) if vals[0] else None
        location = db.scalar(select(BaseLocation).where(BaseLocation.code == vals[1])) if vals[1] else None
        if product is None:
            fail_rows.append({"row": idx, "reason": f"商品编码 {vals[0]} 不存在"})
            continue
        if location is None:
            fail_rows.append({"row": idx, "reason": f"库位编码 {vals[1]} 不存在"})
            continue
        if not _DECIMAL_RE.match(vals[2]) or Decimal(vals[2]) <= 0:
            fail_rows.append({"row": idx, "reason": "数量必须为正数"})
            continue
        cost = Decimal(vals[3]) if _DECIMAL_RE.match(vals[3]) else Decimal(0)
        db.add(StkOpeningItem(bill_id=bill.id, product_id=product.id, location_id=location.id, qty=Decimal(vals[2]), cost_price=cost))
        success += 1
    if success == 0:
        db.rollback()
        raise BizError(E_PARAM, "导入全部失败，未生成草稿")
    db.commit()
    return ok({"draft_id": bill.id, "bill_no": bill.bill_no, "success_count": success, "fail_rows": fail_rows})


# ============================ 库存查询 / 流水 ============================


@router.get("/stock")
def list_stock(
    product_id: int = Query(0),
    warehouse_id: int = Query(0),
    location_id: int = Query(0),
    keyword: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(StkStock)
    if product_id:
        stmt = stmt.where(StkStock.product_id == product_id)
    if warehouse_id:
        stmt = stmt.where(StkStock.warehouse_id == warehouse_id)
    if location_id:
        stmt = stmt.where(StkStock.location_id == location_id)
    if keyword:
        like = f"%{keyword}%"
        prod_ids = db.scalars(select(BaseProduct.id).where(or_(
            BaseProduct.name.like(like), BaseProduct.code.like(like),
            BaseProduct.barcode.like(like), BaseProduct.sku.like(like),
        ))).all()
        stmt = stmt.where(StkStock.product_id.in_(prod_ids) if prod_ids else False)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(StkStock.product_id, StkStock.location_id).offset((page - 1) * page_size).limit(page_size)).all()
    out = []
    for s in rows:
        p = db.get(BaseProduct, s.product_id)
        wh = db.get(BaseWarehouse, s.warehouse_id)
        loc = db.get(BaseLocation, s.location_id)
        out.append(StockRow(
            product_id=s.product_id, product_name=p.name if p else "", code=p.code if p else "",
            material_code=p.material_code if p else "", barcode=p.barcode if p else "", spec=p.spec if p else "",
            warehouse_id=s.warehouse_id, warehouse_name=wh.name if wh else "",
            location_id=s.location_id, location_code=loc.code if loc else "",
            qty=s.qty, cost_price=s.cost_price, amount=(s.qty * s.cost_price).quantize(_DEC2),
        ).model_dump())
    return ok(PageData(list=out, total=total, page=page, page_size=page_size).model_dump())


@router.get("/stock/flow")
def list_stock_flow(
    product_id: int = Query(0),
    bill_no: str = Query("", max_length=30),
    change_type: str = Query("", max_length=20),
    start: str = Query(""),
    end: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
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
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(StkStockLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    out = []
    for log in rows:
        p = db.get(BaseProduct, log.product_id)
        wh = db.get(BaseWarehouse, log.warehouse_id)
        loc = db.get(BaseLocation, log.location_id)
        out.append(StockFlowRow(
            id=log.id, product_id=log.product_id, product_name=p.name if p else "", code=p.code if p else "",
            warehouse_name=wh.name if wh else "", location_code=loc.code if loc else "",
            change_type=log.change_type, bill_no=log.bill_no,
            before_qty=log.before_qty, change_qty=log.change_qty, after_qty=log.after_qty,
            cost_price=log.cost_price, operator_name=_user_name(db, log.operator_id),
            remark=log.remark, created_at=log.created_at,
        ).model_dump())
    return ok(PageData(list=out, total=total, page=page, page_size=page_size).model_dump())


@router.get("/stock/location-summary")
def location_summary(
    warehouse_id: int = Query(0),
    shelf_id: int = Query(0),
    db: Session = Depends(get_db),
) -> dict:
    """2D 货架图数据源：仓库/货架下每个库位的商品库存 + 预警状态（绿=正常/红=低/黄=高）。

    与 /locations 的区别：本接口一次返回库位上的库存明细（商品+数量+预警），
    避免货架图 N+1 请求。
    """
    stmt = select(BaseLocation)
    if warehouse_id:
        stmt = stmt.where(BaseLocation.warehouse_id == warehouse_id)
    if shelf_id:
        stmt = stmt.where(BaseLocation.shelf_id == shelf_id)
    locations = db.scalars(stmt.order_by(BaseLocation.layer_no, BaseLocation.code)).all()
    if not locations:
        return ok([])
    loc_ids = [loc.id for loc in locations]

    stocks = db.scalars(
        select(StkStock).where(StkStock.location_id.in_(loc_ids), StkStock.qty != 0)
    ).all()
    prod_ids = {s.product_id for s in stocks}
    products = {p.id: p for p in db.scalars(select(BaseProduct).where(BaseProduct.id.in_(prod_ids))).all()}

    by_loc: dict[int, list[dict]] = {}
    for s in stocks:
        p = products.get(s.product_id)
        if p is None:
            continue
        if p.min_stock and s.qty < p.min_stock:
            alert = "low"
        elif p.max_stock and s.qty > p.max_stock:
            alert = "high"
        else:
            alert = "normal"
        by_loc.setdefault(s.location_id, []).append({
            "product_id": s.product_id,
            "code": p.code,
            "name": p.name,
            "spec": p.spec,
            "qty": _fmt_qty(s.qty),
            "min_stock": _fmt_qty(p.min_stock),
            "max_stock": _fmt_qty(p.max_stock),
            "alert": alert,
        })
    return ok([
        {
            "location_id": loc.id,
            "location_code": loc.code,
            "layer_no": loc.layer_no,
            "items": by_loc.get(loc.id, []),
        }
        for loc in locations
    ])
