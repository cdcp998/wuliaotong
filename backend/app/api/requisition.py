"""领用接口：使用者申请/我的申请、仓管员审计、通知（《后端API设计.md》§4、§9）。

审计通过 = 同一事务：行锁校验库存 → post_stock_change 扣减 → 状态更新 → 站内通知申请人；
任一明细库存不足 → 整单回滚（4001）。
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import BizError, E_BILL_STATUS, E_NO_PERMISSION, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.base import BaseLocation, BaseProduct, BaseWarehouse
from app.models.requisition import (
    REQ_STATUS_APPROVED,
    REQ_STATUS_CANCELED,
    REQ_STATUS_PENDING,
    REQ_STATUS_REJECTED,
    OutRequisition,
    OutRequisitionItem,
)
from app.models.sys import SysNotification, SysRole, SysUser
from app.schemas.requisition import (
    AuditReq,
    PageData,
    RequisitionItemOut,
    RequisitionOut,
    RequisitionReq,
)
from app.services.stock import generate_bill_no, post_stock_change

router = APIRouter(tags=["领用"], dependencies=[Depends(get_current_user)])

_DECIMAL_RE = __import__("re").compile(r"^\d+(\.\d+)?$")


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


def _req_out(db: Session, r: OutRequisition) -> dict:
    items = db.scalars(
        select(OutRequisitionItem).where(OutRequisitionItem.requisition_id == r.id).order_by(OutRequisitionItem.sort)
    ).all()
    wh = db.get(BaseWarehouse, r.warehouse_id)
    return RequisitionOut(
        id=r.id, bill_no=r.bill_no, applicant_id=r.applicant_id,
        applicant_name=_user_name(db, r.applicant_id),
        use_location=r.use_location, use_reason=r.use_reason,
        warehouse_id=r.warehouse_id, warehouse_name=wh.name if wh else "",
        total_qty=r.total_qty, status=r.status,
        audit_by=r.audit_by, audit_name=_user_name(db, r.audit_by),
        audit_time=r.audit_time, audit_remark=r.audit_remark,
        remark=r.remark, created_at=r.created_at,
        items=[
            RequisitionItemOut(
                id=it.id, product_id=it.product_id,
                product_name=(p.name if (p := db.get(BaseProduct, it.product_id)) else ""),
                code=(p.code if (p := db.get(BaseProduct, it.product_id)) else ""),
                spec=(p.spec if (p := db.get(BaseProduct, it.product_id)) else ""),
                location_id=it.location_id, location_code=_loc_code(db, it.location_id),
                qty=it.qty, photo_file_id=it.photo_file_id,
            )
            for it in items
        ],
    ).model_dump()


def _notify(db: Session, user_id: int, title: str, content: str, biz_type: str) -> None:
    """站内通知（调用方事务内）。"""
    db.add(SysNotification(user_id=user_id, title=title, content=content, biz_type=biz_type))


def _replace_items(db: Session, req_id: int, items: list) -> Decimal:
    db.execute(OutRequisitionItem.__table__.delete().where(OutRequisitionItem.requisition_id == req_id))
    total = Decimal(0)
    for idx, item in enumerate(items):
        if db.get(BaseProduct, item.product_id) is None:
            raise BizError(E_NOT_FOUND, f"商品 id={item.product_id} 不存在")
        if db.get(BaseLocation, item.location_id) is None:
            raise BizError(E_NOT_FOUND, f"库位 id={item.location_id} 不存在")
        qty = _parse_qty(item.qty)
        total += qty
        db.add(OutRequisitionItem(
            requisition_id=req_id, product_id=item.product_id, qty=qty,
            location_id=item.location_id, photo_file_id=item.photo_file_id, sort=idx,
        ))
    return total


# ============================ 申请（使用者手机端） ============================


@router.post("/requisitions", dependencies=[Depends(require_permission("req:apply"))])
def create_requisition(
    req: RequisitionReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if db.get(BaseWarehouse, req.warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    bill = OutRequisition(
        bill_no=generate_bill_no(db, "LL", OutRequisition),
        applicant_id=user.id,
        use_location=req.use_location,
        use_reason=req.use_reason,
        warehouse_id=req.warehouse_id,
        status=REQ_STATUS_PENDING,
        remark=req.remark,
    )
    db.add(bill)
    db.flush()
    bill.total_qty = _replace_items(db, bill.id, req.items)
    db.commit()
    return ok({"id": bill.id, "bill_no": bill.bill_no, "status": REQ_STATUS_PENDING})


@router.get("/requisitions/my", dependencies=[Depends(require_permission("req:apply"))])
def my_requisitions(
    status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(OutRequisition).where(OutRequisition.applicant_id == user.id)
    if status is not None:
        stmt = stmt.where(OutRequisition.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(OutRequisition.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[_req_out(db, r) for r in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/requisitions", dependencies=[Depends(require_permission("req:audit"))])
def list_requisitions(
    status: int | None = Query(None),
    keyword: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(OutRequisition)
    if status is not None:
        stmt = stmt.where(OutRequisition.status == status)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(
            OutRequisition.bill_no.like(like)
            | OutRequisition.use_location.like(like)
            | OutRequisition.use_reason.like(like)
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(OutRequisition.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok(PageData(list=[_req_out(db, r) for r in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/requisitions/{req_id}")
def get_requisition(
    req_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    role = db.get(SysRole, user.role_id)
    can_audit = role and (role.code == "super_admin" or "req:audit" in _permission_codes(db, user))
    if r.applicant_id != user.id and not can_audit:
        raise BizError(E_NO_PERMISSION, "无权限查看该领用单", http_status=403)
    return ok(_req_out(db, r))


def _permission_codes(db: Session, user: SysUser) -> list[str]:
    from app.models.sys import SysPermission, SysRolePermission

    return list(db.scalars(
        select(SysPermission.code)
        .join(SysRolePermission, SysRolePermission.permission_id == SysPermission.id)
        .where(SysRolePermission.role_id == user.role_id)
    ).all())


@router.put("/requisitions/{req_id}", dependencies=[Depends(require_permission("req:apply"))])
def update_requisition(
    req_id: int,
    req: RequisitionReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    if r.applicant_id != user.id:
        raise BizError(E_NO_PERMISSION, "只能修改自己的申请", http_status=403)
    if r.status != REQ_STATUS_REJECTED:
        raise BizError(E_BILL_STATUS, "仅已驳回的申请可修改后重新提交")
    r.use_location = req.use_location
    r.use_reason = req.use_reason
    r.warehouse_id = req.warehouse_id
    r.remark = req.remark
    r.status = REQ_STATUS_PENDING
    r.audit_by = 0
    r.audit_time = None
    r.audit_remark = ""
    r.total_qty = _replace_items(db, r.id, req.items)
    db.commit()
    return ok()


@router.post("/requisitions/{req_id}/cancel", dependencies=[Depends(require_permission("req:apply"))])
def cancel_requisition(
    req_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    if r.applicant_id != user.id:
        raise BizError(E_NO_PERMISSION, "只能取消自己的申请", http_status=403)
    if r.status != REQ_STATUS_PENDING:
        raise BizError(E_BILL_STATUS, "仅待审计的申请可取消")
    r.status = REQ_STATUS_CANCELED
    db.commit()
    return ok()


# ============================ 审计（仓管员） ============================


@router.post("/requisitions/{req_id}/audit", dependencies=[Depends(require_permission("req:audit"))])
def audit_requisition(
    req_id: int,
    body: AuditReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    if r.status != REQ_STATUS_PENDING:
        raise BizError(E_BILL_STATUS, "仅待审计的申请可审计")

    if body.action == "reject":
        r.status = REQ_STATUS_REJECTED
        r.audit_by = user.id
        r.audit_time = datetime.now()
        r.audit_remark = body.remark
        _notify(db, r.applicant_id, "领用申请被驳回", f"{r.bill_no} 被驳回：{body.remark or '无'}", "审批")
        db.commit()
        return ok()

    # approve：逐条扣库存，任一不足整单回滚
    items = db.scalars(select(OutRequisitionItem).where(OutRequisitionItem.requisition_id == r.id).order_by(OutRequisitionItem.sort)).all()
    if not items:
        raise BizError(E_PARAM, "领用单明细为空")
    for it in items:
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=r.warehouse_id, location_id=it.location_id,
            change_type="领用出库", bill_type="out_requisition", bill_no=r.bill_no,
            bill_item_id=it.id, qty_delta=-it.qty, cost_price=Decimal(0),
            photo_file_id=it.photo_file_id, operator_id=user.id,
        )
    r.status = REQ_STATUS_APPROVED
    r.audit_by = user.id
    r.audit_time = datetime.now()
    r.audit_remark = body.remark
    _notify(db, r.applicant_id, "领用申请已通过", f"{r.bill_no} 已通过审计，请凭单领用", "审批")
    db.commit()
    return ok()
