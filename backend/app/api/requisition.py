"""领用接口：使用者申请/我的申请、仓管员审计、通知（《后端API设计.md》§4、§9）。

流程（2026-08-06 确认）：**提交申请 = 自动出库**（允许负库存：实际与仓库账可能不符，
库存不足先出库并站内通知管理员核对）；驳回/取消自动回补库存；审计通过仅确认状态。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from PIL import Image
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
    REQ_STATUS_WORKING,
    OutRequisition,
    OutRequisitionItem,
)
from app.models.sys import SysConfig, SysFile, SysNotification, SysRole, SysStorage, SysUser
from app.schemas.requisition import (
    AuditReq,
    DisplayReq,
    PageData,
    RequisitionItemOut,
    RequisitionOut,
    RequisitionReq,
    WorkDoneReq,
    WorkLocationReq,
)
from app.services.stock import generate_bill_no, post_stock_change
from app.services.storage import resolve_storage_path
from app.services.watermark import (
    WATERMARK_DEFAULT_POSITION,
    WATERMARK_DEFAULT_TEMPLATE,
    WATERMARK_POSITIONS,
    render_template,
    render_watermark,
)

router = APIRouter(tags=["领用"], dependencies=[Depends(get_current_user)])

_DECIMAL_RE = __import__("re").compile(r"^\d+(\.\d+)?$")

# 库存不足提示的接收角色（同库存预警）
ALERT_RECEIVER_ROLES = ("super_admin", "manager", "storekeeper")


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


def _is_admin_user(db: Session, user: SysUser) -> bool:
    """管理员 = 超级管理员或拥有领用审计权限（仓管员等）；私用状态仅管理员可见。"""
    role = db.get(SysRole, user.role_id)
    return bool(role and (role.code == "super_admin" or "req:audit" in _permission_codes(db, user)))


def _pick_display_values(db: Session, exclude_id: int) -> tuple[str, str]:
    """私用掩护值：随机取自最近 30 天内尚未盘点（创建 30 天内）的其他领用单；无可用则用默认话术。"""
    row = db.execute(
        select(OutRequisition.use_reason, OutRequisition.use_location)
        .where(
            OutRequisition.id != exclude_id,
            OutRequisition.is_private == 0,
            OutRequisition.created_at >= datetime.now() - timedelta(days=30),
        )
        .order_by(func.rand())
        .limit(1)
    ).first()
    if row:
        return row.use_reason, row.use_location
    return "日常工作使用", "公司办公区"


def _apply_private(db: Session, bill: OutRequisition, is_private: int) -> None:
    """私用申请：因何使用锁定为「私用」，并固定对外掩护值（创建时取一次，管理员可改）。"""
    bill.is_private = 1 if is_private else 0
    if bill.is_private:
        bill.use_reason = "私用"
        if not bill.display_reason or not bill.display_location:
            reason, location = _pick_display_values(db, bill.id)
            bill.display_reason = bill.display_reason or reason
            bill.display_location = bill.display_location or location


def _req_out(db: Session, r: OutRequisition, viewer: SysUser | None = None) -> dict:
    items = db.scalars(
        select(OutRequisitionItem).where(OutRequisitionItem.requisition_id == r.id).order_by(OutRequisitionItem.sort)
    ).all()
    wh = db.get(BaseWarehouse, r.warehouse_id)
    # 私用脱敏：非管理员只能看到固定的掩护值（最近 30 天内未盘点领用单中取）；管理员见真实状态 + 可编辑掩护值
    if r.is_private and not (viewer and _is_admin_user(db, viewer)):
        use_location, use_reason = r.display_location or r.use_location, r.display_reason or r.use_reason
        is_private, display_reason, display_location = 0, "", ""
    else:
        use_location, use_reason = r.use_location, r.use_reason
        is_private, display_reason, display_location = r.is_private, r.display_reason, r.display_location
    return RequisitionOut(
        id=r.id, bill_no=r.bill_no, applicant_id=r.applicant_id,
        applicant_name=_user_name(db, r.applicant_id),
        use_location=use_location, use_reason=use_reason,
        is_private=is_private, display_reason=display_reason, display_location=display_location,
        location_photo_file_id=r.location_photo_file_id,
        work_photo_file_id=r.work_photo_file_id,
        work_done_at=r.work_done_at,
        work_lat=r.work_lat,
        work_lng=r.work_lng,
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


def _notify_admins(db: Session, title: str, content: str) -> None:
    """通知管理员（超管/管理者/仓管员）。"""
    role_ids = db.scalars(select(SysRole.id).where(SysRole.code.in_(ALERT_RECEIVER_ROLES))).all()
    uids = db.scalars(
        select(SysUser.id).where(SysUser.role_id.in_(role_ids), SysUser.status == 1)
    ).all()
    for uid in uids:
        db.add(SysNotification(user_id=uid, title=title, content=content, biz_type="预警"))


def _deduct_items(db: Session, r: OutRequisition, operator_id: int) -> list[str]:
    """逐条自动出库（允许负库存：实物与系统账可能不符），返回库存为负的明细提示。"""
    db.flush()  # 会话 autoflush=False：先落库刚新增/替换的明细，查询才可见
    items = db.scalars(
        select(OutRequisitionItem).where(OutRequisitionItem.requisition_id == r.id).order_by(OutRequisitionItem.sort)
    ).all()
    shortages = []
    for it in items:
        log = post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=r.warehouse_id, location_id=it.location_id,
            change_type="领用出库", bill_type="out_requisition", bill_no=r.bill_no,
            bill_item_id=it.id, qty_delta=-it.qty, cost_price=Decimal(0),
            photo_file_id=it.photo_file_id, operator_id=operator_id,
            allow_negative=True,
        )
        if log.after_qty < 0:
            p = db.get(BaseProduct, it.product_id)
            shortages.append(f"{p.name if p else it.product_id}({it.qty}件，出库后库存 {format(log.after_qty, 'f')})")
    return shortages


def _restock_items(db: Session, r: OutRequisition, operator_id: int, change_type: str) -> None:
    """驳回/取消时回补库存（冲销提交时已自动扣减的库存）。"""
    db.flush()
    items = db.scalars(
        select(OutRequisitionItem).where(OutRequisitionItem.requisition_id == r.id).order_by(OutRequisitionItem.sort)
    ).all()
    for it in items:
        post_stock_change(
            db,
            product_id=it.product_id, warehouse_id=r.warehouse_id, location_id=it.location_id,
            change_type=change_type, bill_type="out_requisition", bill_no=r.bill_no,
            bill_item_id=it.id, qty_delta=it.qty, cost_price=Decimal(0),
            photo_file_id=it.photo_file_id, operator_id=operator_id,
        )


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
    # 指定申请人：仅管理员（超管/有审计权限）可代使用者申请
    applicant_id = user.id
    if req.applicant_id:
        if not _is_admin_user(db, user):
            raise BizError(E_NO_PERMISSION, "无权限代他人申请", http_status=403)
        target = db.get(SysUser, req.applicant_id)
        if target is None or target.status != 1:
            raise BizError(E_PARAM, "指定申请人不存在或已停用")
        applicant_id = target.id
    bill = OutRequisition(
        bill_no=generate_bill_no(db, "LL", OutRequisition),
        applicant_id=applicant_id,
        use_location=req.use_location,
        use_reason=req.use_reason,
        is_private=0,
        display_reason="",
        display_location="",
        location_photo_file_id=req.location_photo_file_id,
        warehouse_id=req.warehouse_id,
        status=REQ_STATUS_WORKING,
        remark=req.remark,
    )
    db.add(bill)
    db.flush()
    _apply_private(db, bill, req.is_private)
    bill.total_qty = _replace_items(db, bill.id, req.items)
    # 提交即自动出库（允许负库存，不足通知管理员核对）
    shortages = _deduct_items(db, bill, user.id)
    if shortages:
        _notify_admins(
            db,
            "领用出库库存不足",
            f"{bill.bill_no} 领用出库后以下商品库存为负（实际库存与系统不符，请核对）：{'；'.join(shortages)}",
        )
    db.commit()
    return ok({"id": bill.id, "bill_no": bill.bill_no, "status": REQ_STATUS_WORKING, "shortages": shortages})


@router.get("/requisitions/applicants", dependencies=[Depends(require_permission("req:apply"))])
def requisition_applicants(
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """领用申请可选申请人：管理员返回全部启用使用者（代申请用）；普通使用者仅返回自己。"""
    if not _is_admin_user(db, user):
        return ok([{"id": user.id, "real_name": user.real_name}])
    role_id = db.scalar(select(SysRole.id).where(SysRole.code == "user"))
    users = db.scalars(
        select(SysUser).where(SysUser.role_id == role_id, SysUser.status == 1).order_by(SysUser.id)
    ).all()
    return ok([{"id": u.id, "real_name": u.real_name, "username": u.username} for u in users])


@router.post("/requisitions/{req_id}/work-done", dependencies=[Depends(require_permission("req:apply"))])
def work_done_requisition(
    req_id: int,
    body: WorkDoneReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """完成工作：在工作地点拍照留痕（定位信息用于下载水印），提交后进入待审计。"""
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    if r.applicant_id != user.id:
        raise BizError(E_NO_PERMISSION, "只能提交自己的申请", http_status=403)
    if r.status != REQ_STATUS_WORKING:
        raise BizError(E_BILL_STATUS, "仅待完成工作的申请可提交完成拍照")
    if db.get(SysFile, body.photo_file_id) is None:
        raise BizError(E_PARAM, "照片不存在")
    r.work_photo_file_id = body.photo_file_id
    r.work_done_at = datetime.now()
    r.work_lat = body.lat
    r.work_lng = body.lng
    r.status = REQ_STATUS_PENDING
    _notify_admins(
        db,
        "领用已完成工作待审计",
        f"{r.bill_no} 已完成工作并拍照留痕（含定位水印），请及时审计",
    )
    db.commit()
    return ok()


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
    return ok(PageData(list=[_req_out(db, r, user) for r in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/requisitions", dependencies=[Depends(require_permission("req:audit"))])
def list_requisitions(
    status: int | None = Query(None),
    keyword: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
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
    return ok(PageData(list=[_req_out(db, r, user) for r in rows], total=total, page=page, page_size=page_size).model_dump())


@router.get("/requisitions/{req_id}")
def get_requisition(
    req_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    can_audit = _is_admin_user(db, user)
    if r.applicant_id != user.id and not can_audit:
        raise BizError(E_NO_PERMISSION, "无权限查看该领用单", http_status=403)
    return ok(_req_out(db, r, user))


@router.get("/requisitions/{req_id}/ai-summary", dependencies=[Depends(require_permission("req:audit"))])
def requisition_ai_summary(req_id: int, db: Session = Depends(get_db)) -> dict:
    """领用审核 AI 辅助摘要（P9-P1⑤）：规则聚合上下文 + DeepSeek 生成摘要/风险等级/原因。"""
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    items = db.scalars(
        select(OutRequisitionItem).where(OutRequisitionItem.requisition_id == r.id).order_by(OutRequisitionItem.sort)
    ).all()
    from app.services.ai.req_summary import ai_summary

    return ok(ai_summary(db, r, items))


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
    r.location_photo_file_id = req.location_photo_file_id
    r.warehouse_id = req.warehouse_id
    r.remark = req.remark
    r.status = REQ_STATUS_WORKING
    r.audit_by = 0
    r.audit_time = None
    r.audit_remark = ""
    r.work_photo_file_id = 0  # 重新提交后需重新完成工作拍照
    r.work_done_at = None
    r.work_lat = ""
    r.work_lng = ""
    _apply_private(db, r, req.is_private)  # 私用单重提保持私用，掩护值沿用
    r.total_qty = _replace_items(db, r.id, req.items)
    # 驳回后重新提交：再次自动出库（驳回时已回补）
    shortages = _deduct_items(db, r, user.id)
    if shortages:
        _notify_admins(
            db,
            "领用出库库存不足",
            f"{r.bill_no} 领用出库后以下商品库存为负（实际库存与系统不符，请核对）：{'；'.join(shortages)}",
        )
    db.commit()
    return ok({"shortages": shortages})


@router.put("/requisitions/{req_id}/display", dependencies=[Depends(require_permission("req:audit"))])
def update_requisition_display(req_id: int, req: DisplayReq, db: Session = Depends(get_db)) -> dict:
    """管理员编辑私用申请的对外显示信息（掩护值，固定展示给非管理员）。"""
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    if not r.is_private:
        raise BizError(E_PARAM, "仅私用申请可编辑对外显示信息")
    r.display_reason = req.display_reason
    r.display_location = req.display_location
    db.commit()
    return ok()


@router.put("/requisitions/{req_id}/work-location", dependencies=[Depends(require_permission("req:audit"))])
def update_work_location(req_id: int, req: WorkLocationReq, db: Session = Depends(get_db)) -> dict:
    """管理员编辑领用单的 GPS 坐标与地点信息（用于水印/记录；无原始 {location} 时可用逆地理编码补全）。"""
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    r.use_location = req.use_location
    r.work_lat = req.lat
    r.work_lng = req.lng
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
    if r.status not in (REQ_STATUS_WORKING, REQ_STATUS_PENDING):
        raise BizError(E_BILL_STATUS, "仅待完成工作/待审计的申请可取消")
    # 取消回补库存（提交时已自动出库）
    _restock_items(db, r, user.id, "领用取消回补")
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
        raise BizError(E_BILL_STATUS, "仅待审计（已完成工作拍照）的申请可审计")

    if body.action == "reject":
        # 驳回回补库存（提交时已自动出库）
        _restock_items(db, r, user.id, "领用驳回回补")
        r.status = REQ_STATUS_REJECTED
        r.audit_by = user.id
        r.audit_time = datetime.now()
        r.audit_remark = body.remark
        _notify(db, r.applicant_id, "领用申请被驳回", f"{r.bill_no} 被驳回：{body.remark or '无'}，库存已回补", "审批")
        db.commit()
        return ok()

    # approve：库存已在提交时自动扣减，审计通过仅确认状态
    items = db.scalars(select(OutRequisitionItem).where(OutRequisitionItem.requisition_id == r.id).order_by(OutRequisitionItem.sort)).all()
    if not items:
        raise BizError(E_PARAM, "领用单明细为空")
    r.status = REQ_STATUS_APPROVED
    r.audit_by = user.id
    r.audit_time = datetime.now()
    r.audit_remark = body.remark
    _notify(db, r.applicant_id, "领用申请已通过", f"{r.bill_no} 已通过审计，请凭单领用", "审批")
    db.commit()
    return ok()


# ============================ 完成工作照片水印（下载时动态添加） ============================


@router.get("/requisitions/{req_id}/work-photo")
def work_photo(req_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """下载完成工作照片（动态添加地点/时间/定位水印，原图不保存水印）。本人或管理员可下载。"""
    r = db.get(OutRequisition, req_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "领用单不存在")
    if not _is_admin_user(db, user) and r.applicant_id != user.id:
        raise BizError(E_NO_PERMISSION, "无权限下载该照片", http_status=403)
    if not r.work_photo_file_id:
        raise BizError(E_NOT_FOUND, "尚未上传完成工作照片")
    f = db.get(SysFile, r.work_photo_file_id)
    storage = db.get(SysStorage, f.storage_id) if f else None
    path = resolve_storage_path(storage) / f.file_path if f and storage else None
    if path is None or not path.exists():
        raise BizError(E_NOT_FOUND, "照片文件不存在")

    template = (
        db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.template"))
        or WATERMARK_DEFAULT_TEMPLATE
    )
    position = (
        db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.position"))
        or WATERMARK_DEFAULT_POSITION
    )
    bg_cfg = db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.bg_opaque"))
    gps = f"{r.work_lat},{r.work_lng}" if r.work_lat and r.work_lng else "未获取定位"
    t = r.work_done_at.strftime("%Y-%m-%d %H:%M:%S") if r.work_done_at else ""
    text = render_template(template, r.use_location, t, gps)
    img = render_watermark(
        Image.open(path),
        text,
        position if position in WATERMARK_POSITIONS else WATERMARK_DEFAULT_POSITION,
        bg_opaque=bg_cfg != "0",
    )

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    filename = f"{r.bill_no}_完成工作水印.png"
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
