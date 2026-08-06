"""库存进阶接口：调拨/盘点/其他出入库（《后端API设计.md》§5）。

库存一致性：全部走 services/stock.py 的 post_stock_change()，与单据状态同事务提交。
"""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import BizError, E_BILL_STATUS, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.advanced import (
    StkCheck,
    StkCheckItem,
    StkOtherIo,
    StkOtherIoItem,
    StkTransfer,
    StkTransferItem,
)
from app.models.base import BaseLocation, BaseProduct, BaseWarehouse
from app.models.stock import StkStock
from app.models.sys import SysUser
from app.schemas.advanced import (
    CheckItemOut,
    CheckItemsReq,
    CheckOut,
    CheckReq,
    IN_TYPES,
    OtherIoItemReq,
    OtherIoOut,
    OtherIoReq,
    PageData,
    TransferItemReq,
    TransferOut,
    TransferReq,
)
from app.services.stock import generate_bill_no, post_stock_change

router = APIRouter(tags=["库存进阶"], dependencies=[Depends(get_current_user)])

_DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")


def _parse_qty(v: str) -> Decimal:
    if not _DECIMAL_RE.match(v) or Decimal(v) <= 0:
        raise BizError(E_PARAM, "数量必须为正数")
    return Decimal(v)


def _user_name(db: Session, uid: int) -> str:
    u = db.get(SysUser, uid)
    return u.real_name if u else ""


def _loc_code(db: Session, loc_id: int) -> str:
    loc = db.get(BaseLocation, loc_id)
    return loc.code if loc else ""


def _item_out(db: Session, product_id: int, location_id: int, qty: Decimal, item_id: int) -> dict:
    return {
        "id": item_id,
        "product_id": product_id,
        "product_name": (p.name if (p := db.get(BaseProduct, product_id)) else ""),
        "code": (p.code if (p := db.get(BaseProduct, product_id)) else ""),
        "location_id": location_id,
        "location_code": _loc_code(db, location_id),
        "qty": format(qty, "f"),
    }


# ============================ 调拨 ============================


@router.post("/transfers", dependencies=[Depends(require_permission("stk:transfer"))])
def create_transfer(
    req: Annotated[TransferReq, Body()],
    db: Session = Depends(get_db),
) -> dict:
    if req.from_warehouse_id == req.to_warehouse_id:
        raise BizError(E_PARAM, "调出仓库与调入仓库不能相同")
    if db.get(BaseWarehouse, req.from_warehouse_id) is None or db.get(BaseWarehouse, req.to_warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    bill = StkTransfer(
        bill_no=generate_bill_no(db, "DB", StkTransfer),
        from_warehouse_id=req.from_warehouse_id,
        to_warehouse_id=req.to_warehouse_id,
        status=0,
        remark=req.remark,
    )
    db.add(bill)
    db.flush()
    for idx, item in enumerate(req.items):
        if db.get(BaseProduct, item.product_id) is None:
            raise BizError(E_NOT_FOUND, f"商品 id={item.product_id} 不存在")
        if db.get(BaseLocation, item.from_location_id) is None or db.get(BaseLocation, item.to_location_id) is None:
            raise BizError(E_NOT_FOUND, "库位不存在")
        db.add(StkTransferItem(
            transfer_id=bill.id, product_id=item.product_id, qty=_parse_qty(item.qty),
            from_location_id=item.from_location_id, to_location_id=item.to_location_id,
        ))
    db.commit()
    return ok({"id": bill.id, "bill_no": bill.bill_no, "status": 0})


def _transfer_out(db: Session, b: StkTransfer) -> dict:
    items = db.scalars(select(StkTransferItem).where(StkTransferItem.transfer_id == b.id)).all()
    return TransferOut(
        id=b.id, bill_no=b.bill_no,
        from_warehouse_id=b.from_warehouse_id,
        from_warehouse_name=(w.name if (w := db.get(BaseWarehouse, b.from_warehouse_id)) else ""),
        to_warehouse_id=b.to_warehouse_id,
        to_warehouse_name=(w.name if (w := db.get(BaseWarehouse, b.to_warehouse_id)) else ""),
        status=b.status, audit_name=_user_name(db, b.audit_by), audit_time=b.audit_time, remark=b.remark,
        items=[_item_out(db, it.product_id, it.from_location_id, it.qty, it.id) for it in items],
    ).model_dump()


@router.get("/transfers")
def list_transfers(
    status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(StkTransfer)
    if status is not None:
        stmt = stmt.where(StkTransfer.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(StkTransfer.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[_transfer_out(db, b) for b in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/transfers/{bill_id}")
def get_transfer(bill_id: int, db: Session = Depends(get_db)) -> dict:
    b = db.get(StkTransfer, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "调拨单不存在")
    return ok(_transfer_out(db, b))


@router.post("/transfers/{bill_id}/audit", dependencies=[Depends(require_permission("stk:transfer"))])
def audit_transfer(
    bill_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    b = db.get(StkTransfer, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "调拨单不存在")
    if b.status != 0:
        raise BizError(E_BILL_STATUS, "仅草稿可审核")
    items = db.scalars(select(StkTransferItem).where(StkTransferItem.transfer_id == b.id)).all()
    if not items:
        raise BizError(E_PARAM, "调拨明细为空")
    # 同事务：调出仓扣（负）、调入仓加（正），任一库存不足整单回滚
    for it in items:
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=b.from_warehouse_id, location_id=it.from_location_id,
            change_type="调拨出", bill_type="stk_transfer", bill_no=b.bill_no,
            bill_item_id=it.id, qty_delta=-it.qty, operator_id=user.id,
        )
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=b.to_warehouse_id, location_id=it.to_location_id,
            change_type="调拨入", bill_type="stk_transfer", bill_no=b.bill_no,
            bill_item_id=it.id, qty_delta=it.qty, cost_price=Decimal(0), operator_id=user.id,
        )
    b.status = 1
    b.audit_by = user.id
    b.audit_time = datetime.now()
    db.commit()
    return ok()


@router.post("/transfers/{bill_id}/void", dependencies=[Depends(require_permission("stk:transfer"))])
def void_transfer(
    bill_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    b = db.get(StkTransfer, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "调拨单不存在")
    if b.status == -1:
        raise BizError(E_BILL_STATUS, "单据已作废")
    if b.status == 1:
        # 已审核：反向冲销（调入仓扣回、调出仓加回），校验调入仓库存充足
        items = db.scalars(select(StkTransferItem).where(StkTransferItem.transfer_id == b.id)).all()
        for it in items:
            post_stock_change(
                db,
                product_id=it.product_id, warehouse_id=b.to_warehouse_id, location_id=it.to_location_id,
                change_type="调拨作废", bill_type="stk_transfer", bill_no=b.bill_no,
                bill_item_id=it.id, qty_delta=-it.qty, operator_id=user.id, remark="作废冲销",
            )
            post_stock_change(
                db,
                product_id=it.product_id, warehouse_id=b.from_warehouse_id, location_id=it.from_location_id,
                change_type="调拨作废", bill_type="stk_transfer", bill_no=b.bill_no,
                bill_item_id=it.id, qty_delta=it.qty, cost_price=Decimal(0), operator_id=user.id, remark="作废冲销",
            )
    b.status = -1
    db.commit()
    return ok()


# ============================ 盘点 ============================


@router.post("/checks", dependencies=[Depends(require_permission("stk:check"))])
def create_check(
    req: CheckReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(BaseWarehouse, req.warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    bill = StkCheck(
        bill_no=generate_bill_no(db, "PD", StkCheck),
        warehouse_id=req.warehouse_id,
        status=0,
        checker_id=user.id,
        check_date=datetime.now(),
        remark=req.remark,
    )
    db.add(bill)
    db.flush()
    # 自动带出该仓库全部库存明细（商品×库位）
    rows = db.execute(
        select(StkStock.product_id, StkStock.location_id, StkStock.qty)
        .where(StkStock.warehouse_id == req.warehouse_id, StkStock.qty != 0)
    ).all()
    for product_id, location_id, qty in rows:
        db.add(StkCheckItem(check_id=bill.id, product_id=product_id, location_id=location_id, book_qty=qty, diff_qty=0))
    db.commit()
    return ok({"id": bill.id, "bill_no": bill.bill_no, "status": 0, "item_count": len(rows)})


def _check_out(db: Session, b: StkCheck) -> dict:
    items = db.scalars(select(StkCheckItem).where(StkCheckItem.check_id == b.id).order_by(StkCheckItem.id)).all()
    return CheckOut(
        id=b.id, bill_no=b.bill_no, warehouse_id=b.warehouse_id,
        warehouse_name=(w.name if (w := db.get(BaseWarehouse, b.warehouse_id)) else ""),
        status=b.status, checker_name=_user_name(db, b.checker_id), check_date=b.check_date, remark=b.remark,
        items=[
            CheckItemOut(
                id=it.id, product_id=it.product_id,
                product_name=(p.name if (p := db.get(BaseProduct, it.product_id)) else ""),
                code=(p.code if (p := db.get(BaseProduct, it.product_id)) else ""),
                location_id=it.location_id, location_code=_loc_code(db, it.location_id),
                book_qty=it.book_qty, real_qty=it.real_qty, diff_qty=it.diff_qty,
            )
            for it in items
        ],
    ).model_dump()


@router.get("/checks")
def list_checks(
    status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(StkCheck)
    if status is not None:
        stmt = stmt.where(StkCheck.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(StkCheck.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[_check_out(db, b) for b in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/checks/{bill_id}")
def get_check(bill_id: int, db: Session = Depends(get_db)) -> dict:
    b = db.get(StkCheck, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "盘点单不存在")
    return ok(_check_out(db, b))


@router.put("/checks/{bill_id}/items", dependencies=[Depends(require_permission("stk:check"))])
def update_check_items(bill_id: int, req: CheckItemsReq, db: Session = Depends(get_db)) -> dict:
    b = db.get(StkCheck, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "盘点单不存在")
    if b.status not in (0, 1):
        raise BizError(E_BILL_STATUS, "已审核的盘点单不可修改")
    for item in req.items:
        ci = db.get(StkCheckItem, item.check_item_id)
        if ci is None or ci.check_id != b.id:
            raise BizError(E_NOT_FOUND, f"盘点明细 id={item.check_item_id} 不存在")
        ci.real_qty = _parse_qty(item.real_qty)
        ci.diff_qty = (ci.real_qty - ci.book_qty).quantize(Decimal("0.001"))
    if b.status == 0:
        b.status = 1  # 录入实盘后进入"盘点中"
    db.commit()
    return ok()


@router.post("/checks/{bill_id}/audit", dependencies=[Depends(require_permission("stk:check"))])
def audit_check(
    bill_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    b = db.get(StkCheck, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "盘点单不存在")
    if b.status != 1:
        raise BizError(E_BILL_STATUS, "仅盘点中（已录实盘）的单据可审核")
    items = db.scalars(select(StkCheckItem).where(StkCheckItem.check_id == b.id)).all()
    if not items:
        raise BizError(E_PARAM, "盘点明细为空")
    for it in items:
        if it.real_qty is None:
            raise BizError(E_PARAM, f"盘点明细 id={it.id} 未录入实盘数量")
        if it.diff_qty == 0:
            continue
        change_type = "盘盈" if it.diff_qty > 0 else "盘亏"
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=b.warehouse_id, location_id=it.location_id,
            change_type=change_type, bill_type="stk_check", bill_no=b.bill_no,
            bill_item_id=it.id, qty_delta=it.diff_qty, cost_price=Decimal(0), operator_id=user.id,
            remark=f"账面 {format(it.book_qty, 'f')} → 实盘 {format(it.real_qty, 'f')}",
        )
    b.status = 2
    db.commit()
    return ok()


# ============================ 其他出入库 ============================


@router.post("/other-io", dependencies=[Depends(require_permission("stk:other"))])
def create_other_io(
    req: OtherIoReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(BaseWarehouse, req.warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    bill = StkOtherIo(
        bill_no=generate_bill_no(db, "QT", StkOtherIo),
        warehouse_id=req.warehouse_id,
        io_type=req.io_type,
        status=1,  # 直接过账
        operator_id=user.id,
        remark=req.remark,
    )
    db.add(bill)
    db.flush()
    direction = 1 if req.io_type in IN_TYPES else -1
    for idx, item in enumerate(req.items):
        if db.get(BaseProduct, item.product_id) is None:
            raise BizError(E_NOT_FOUND, f"商品 id={item.product_id} 不存在")
        if db.get(BaseLocation, item.location_id) is None:
            raise BizError(E_NOT_FOUND, f"库位 id={item.location_id} 不存在")
        qty = _parse_qty(item.qty)
        item_row = StkOtherIoItem(
            bill_id=bill.id, product_id=item.product_id, qty=qty,
            location_id=item.location_id, photo_file_id=item.photo_file_id, sort=idx,
        )
        db.add(item_row)
        db.flush()
        post_stock_change(
            db,
            product_id=item.product_id, warehouse_id=req.warehouse_id, location_id=item.location_id,
            change_type=req.io_type, bill_type="stk_other_io", bill_no=bill.bill_no,
            bill_item_id=item_row.id, qty_delta=direction * qty, cost_price=Decimal(0),
            photo_file_id=item.photo_file_id, operator_id=user.id,
        )
    db.commit()
    return ok({"id": bill.id, "bill_no": bill.bill_no, "status": 1})


def _other_out(db: Session, b: StkOtherIo) -> dict:
    items = db.scalars(select(StkOtherIoItem).where(StkOtherIoItem.bill_id == b.id).order_by(StkOtherIoItem.sort)).all()
    return OtherIoOut(
        id=b.id, bill_no=b.bill_no, warehouse_id=b.warehouse_id,
        warehouse_name=(w.name if (w := db.get(BaseWarehouse, b.warehouse_id)) else ""),
        io_type=b.io_type, status=b.status, operator_name=_user_name(db, b.operator_id), remark=b.remark,
        items=[_item_out(db, it.product_id, it.location_id, it.qty, it.id) for it in items],
    ).model_dump()


@router.get("/other-io")
def list_other_io(
    io_type: str = Query("", max_length=20),
    status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(StkOtherIo)
    if io_type:
        stmt = stmt.where(StkOtherIo.io_type == io_type)
    if status is not None:
        stmt = stmt.where(StkOtherIo.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(StkOtherIo.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[_other_out(db, b) for b in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/other-io/{bill_id}")
def get_other_io(bill_id: int, db: Session = Depends(get_db)) -> dict:
    b = db.get(StkOtherIo, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "其他出入库单不存在")
    return ok(_other_out(db, b))


@router.post("/other-io/{bill_id}/void", dependencies=[Depends(require_permission("stk:other"))])
def void_other_io(
    bill_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    b = db.get(StkOtherIo, bill_id)
    if b is None:
        raise BizError(E_NOT_FOUND, "其他出入库单不存在")
    if b.status != 1:
        raise BizError(E_BILL_STATUS, "仅已过账单据可作废")
    items = db.scalars(select(StkOtherIoItem).where(StkOtherIoItem.bill_id == b.id)).all()
    direction = -1 if b.io_type in IN_TYPES else 1  # 反向冲销
    for it in items:
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=b.warehouse_id, location_id=it.location_id,
            change_type=f"{b.io_type}作废", bill_type="stk_other_io", bill_no=b.bill_no,
            bill_item_id=it.id, qty_delta=direction * it.qty, cost_price=Decimal(0),
            operator_id=user.id, remark="作废冲销",
        )
    b.status = -1
    db.commit()
    return ok()
