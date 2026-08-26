"""device 模块接口（设备台账 CRUD/生命周期/设备维修任务（复用 task_engine）/领用关联，方案 §6.5）。

router 级依赖：require_module_enabled("device")。
架构说明（v1.1）：设备维修任务复用核心 task_engine，**不依赖 task 模块**独立运行；
「任务→物料领用链接」复用 task 模块的 task_requisition 表，属增强功能——运行期经
module_enabled("task") 守卫（task 未启用时领用关联接口 403，其余不受影响）。

设备生命周期（§5.8）：1 在用 ⇄ 2 维修中 ⇄ 3 闲置 → 4 报废；2 维修中禁止报废；
创建设备维修任务自动置维修中（previous_status 快照）；任务 verify/cancel 按快照回退，
并生成回退文本提示词（通知 + 响应 rollback_prompt 字段）。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import requisition as req_api
from app.core.deps import SUPER_ADMIN_ROLE_CODE, get_current_user, require_any_permission, require_permission
from app.core.modules import module_enabled, require_module_enabled
from app.core.response import BizError, E_BILL_STATUS, E_NOT_FOUND, E_PARAM, ok
from app.core.task_engine import ACTIVE_STATUSES, TERMINAL_STATUS, transition
from app.db import get_db
from app.models import SysNotification, SysRole, SysUser
from app.modules.device.models import Device, DeviceTask, DeviceTaskRecord, DeviceTaskRecordFile
from app.modules.device.schemas import (
    AssignReq,
    DeviceCreate,
    DeviceFileIn,
    DeviceRequisitionReq,
    DeviceRecordCreate,
    DeviceStatusReq,
    DeviceStatusReqT,
    DeviceTaskCreate,
    DeviceUpdate,
)

logger = logging.getLogger("app.device")

router = APIRouter(tags=["设备管理"], dependencies=[Depends(get_current_user), Depends(require_module_enabled("device"))])

ALL_SCOPE_ROLES = (SUPER_ADMIN_ROLE_CODE, "manager", "dispatcher")
STATUS_LABEL = {1: "在用", 2: "维修中", 3: "闲置", 4: "报废"}
# 允许的状态流转：2（维修中）禁止 → 4（报废）
_DEVICE_FLOW = {1: {2, 3}, 2: {1, 3}, 3: {1, 4}, 4: set()}


def _scope_all(db: Session, user: SysUser) -> bool:
    role = db.get(SysRole, user.role_id)
    return (role.code if role else "") in ALL_SCOPE_ROLES


def _device_or_404(db: Session, device_id: int) -> Device:
    d = db.get(Device, device_id)
    if d is None:
        raise BizError(E_NOT_FOUND, "设备不存在")
    return d


def _task_or_404(db: Session, task_id: int) -> DeviceTask:
    t = db.get(DeviceTask, task_id)
    if t is None:
        raise BizError(E_NOT_FOUND, "设备维修任务不存在")
    return t


def _notify(db: Session, user_id: int, title: str, content: str, link: str, biz_type: str = "待办") -> None:
    if not user_id:
        return
    db.add(SysNotification(user_id=user_id, title=title, content=content, biz_type=biz_type, link=link))


def _task_module_guard(db: Session) -> None:
    """领用关联为增强功能（task_requisition 表属 task 模块）：task 未启用时 403。

    设备维修任务本体不依赖 task 模块；仅此增强接口需要 task 已安装并启用。
    """
    if not module_enabled(db, "task"):
        raise BizError(4009, "依赖模块 task 未启用（任务领用关联为增强功能）", http_status=403)


def _device_cover(db: Session, device_id: int) -> int | None:
    """设备首图 file_id（列表缩略用；无图返回 None）。"""
    from app.modules.device.models import DeviceFile

    return db.scalar(
        select(DeviceFile.file_id).where(DeviceFile.device_id == device_id)
        .order_by(DeviceFile.sort_order, DeviceFile.id).limit(1)
    )


def _device_out(db: Session, d: Device) -> dict:
    cover = _device_cover(db, d.id)
    return {
        "id": d.id, "code": d.code, "name": d.name, "model": d.model, "category": d.category,
        "department_id": d.department_id, "location": d.location,
        "lat": float(d.lat) if d.lat is not None else None,
        "lng": float(d.lng) if d.lng is not None else None,
        "status": d.status,
        "purchase_date": d.purchase_date.isoformat() if d.purchase_date else None,
        "warranty_end": d.warranty_end.isoformat() if d.warranty_end else None,
        "remark": d.remark,
        "cover_file_id": cover,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def _task_out(db: Session, t: DeviceTask, rollback_prompt: str = "") -> dict:
    assignee = db.get(SysUser, t.assignee_id) if t.assignee_id else None
    creator = db.get(SysUser, t.created_by) if t.created_by else None
    d = db.get(Device, t.device_id)
    out = {
        "id": t.id, "task_no": t.task_no, "device_id": t.device_id,
        "device_name": d.name if d else "", "device_code": d.code if d else "",
        "device_status": d.status if d else None,
        "title": t.title, "description": t.description,
        "assignee_id": t.assignee_id, "assignee_name": assignee.real_name if assignee else "",
        "status": t.status,
        "dispatch_mode": getattr(t, "dispatch_mode", "manual") or "manual",
        "priority": t.priority,
        "scheduled_time": t.scheduled_time.isoformat() if t.scheduled_time else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "verdict": t.verdict, "previous_status": t.previous_status,
        "cancel_reason": t.cancel_reason,
        "created_by": t.created_by, "creator_name": creator.real_name if creator else "",
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if rollback_prompt:
        # 回退文本提示词（验收/取消自动回退设备状态时生成，前端直接展示）
        out["rollback_prompt"] = rollback_prompt
    return out


def _gen_task_no(db: Session) -> str:
    """设备任务单号：WX-SB + 日期 + 序号。"""
    from app.services.stock import generate_bill_no

    for _ in range(5):
        no = generate_bill_no(db, "WX-SB", DeviceTask, field="task_no")
        if no:
            return no
    raise BizError(E_BILL_STATUS, "任务单号生成失败，请重试")


# ============================ 设备台账 ============================

@router.get("/devices", dependencies=[Depends(require_any_permission("device:manage", "device:task"))])
def list_devices(
    keyword: str = "",
    status: str = "",
    category: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Device)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(Device.code.like(like) | Device.name.like(like) | Device.model.like(like))
    if status:
        stmt = stmt.where(Device.status == int(status))
    if category:
        stmt = stmt.where(Device.category == category)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Device.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({"total": total, "page": page, "page_size": page_size, "items": [_device_out(db, d) for d in rows]})


@router.get("/devices/{device_id}", dependencies=[Depends(require_any_permission("device:manage", "device:task"))])
def get_device(device_id: int, db: Session = Depends(get_db)) -> dict:
    return ok(_device_out(db, _device_or_404(db, device_id)))


@router.post("/devices", dependencies=[Depends(require_permission("device:manage"))])
def create_device(req: DeviceCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(Device.id).where(Device.code == req.code)):
        raise BizError(E_PARAM, "设备编码已存在")
    d = Device(**req.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return ok(_device_out(db, d))


@router.put("/devices/{device_id}", dependencies=[Depends(require_permission("device:manage"))])
def update_device(device_id: int, req: DeviceUpdate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    d = _device_or_404(db, device_id)
    for k, v in req.model_dump(exclude_none=True).items():
        setattr(d, k, v)
    d.updated_by = user.id
    db.commit()
    return ok(_device_out(db, d))


@router.put("/devices/{device_id}/status", dependencies=[Depends(require_permission("device:manage"))])
def update_device_status(device_id: int, req: DeviceStatusReq, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    d = _device_or_404(db, device_id)
    if req.status not in _DEVICE_FLOW.get(d.status, set()):
        raise BizError(E_BILL_STATUS, f"设备状态不允许从「{STATUS_LABEL.get(d.status, d.status)}」流转到「{STATUS_LABEL.get(req.status, req.status)}」"
                          + ("（维修中的设备禁止报废）" if d.status == 2 and req.status == 4 else ""))
    d.status = req.status
    d.updated_by = user.id
    db.commit()
    return ok(_device_out(db, d))


# ============================ 设备图片（可选，M0001 device_file） ============================

@router.get("/devices/{device_id}/files", dependencies=[Depends(require_any_permission("device:manage", "device:task"))])
def list_device_files(device_id: int, db: Session = Depends(get_db)) -> dict:
    """设备图片列表（前端缩略/编辑展示）。"""
    _device_or_404(db, device_id)
    from app.modules.device.models import DeviceFile

    rows = db.scalars(
        select(DeviceFile).where(DeviceFile.device_id == device_id).order_by(DeviceFile.sort_order, DeviceFile.id)
    ).all()
    return ok([
        {"id": r.id, "file_id": r.file_id, "sort_order": r.sort_order,
         "created_at": r.created_at.isoformat() if r.created_at else None}
        for r in rows
    ])


@router.post("/devices/{device_id}/files", dependencies=[Depends(require_permission("device:manage"))])
def add_device_file(device_id: int, req: DeviceFileIn, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """上传设备图片关联（file_id 来自 /files/upload，可选多张）。"""
    _device_or_404(db, device_id)
    from app.modules.device.models import DeviceFile

    cnt = db.scalar(select(func.count()).select_from(DeviceFile).where(DeviceFile.device_id == device_id)) or 0
    row = DeviceFile(device_id=device_id, file_id=req.file_id, sort_order=cnt, created_by=user.id)
    db.add(row)
    db.commit()
    return ok({"id": row.id})


@router.delete("/devices/{device_id}/files/{link_id}", dependencies=[Depends(require_permission("device:manage"))])
def delete_device_file(device_id: int, link_id: int, db: Session = Depends(get_db)) -> dict:
    """删除设备图片关联（不删 sys_file 本体）。"""
    from app.modules.device.models import DeviceFile

    row = db.get(DeviceFile, link_id)
    if row is None or row.device_id != device_id:
        raise BizError(E_NOT_FOUND, "设备图片不存在")
    db.delete(row)
    db.commit()
    return ok()


# ============================ 设备维修任务 ============================

@router.get("/device-tasks", dependencies=[Depends(require_any_permission("device:task", "device:manage"))])
def list_device_tasks(
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(DeviceTask)
    if not _scope_all(db, user):
        stmt = stmt.where(DeviceTask.assignee_id == user.id)
    if status:
        stmt = stmt.where(DeviceTask.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(DeviceTask.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({"total": total, "page": page, "page_size": page_size, "items": [_task_out(db, t) for t in rows]})


@router.post("/device-tasks", dependencies=[Depends(require_permission("device:task"))])
def create_device_task(req: DeviceTaskCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    d = _device_or_404(db, req.device_id)
    if d.status == 4:
        raise BizError(E_BILL_STATUS, "报废设备不可创建维修任务")
    # 唯一活跃设备任务约束（应用层）
    active = db.scalar(
        select(func.count()).select_from(DeviceTask).where(
            DeviceTask.device_id == d.id, DeviceTask.status.in_(ACTIVE_STATUSES),
        )
    )
    if active:
        raise BizError(E_BILL_STATUS, "该设备已存在未完结维修任务")
    t = DeviceTask(
        task_no="", device_id=d.id, title=req.title, description=req.description,
        priority=req.priority, scheduled_time=req.scheduled_time,
        dispatch_mode=getattr(req, "dispatch_mode", "manual") or "manual",
        created_by=user.id, status="pending",
        previous_status=d.status,  # v2.1：创建时设备状态快照（完成/取消回退）
    )
    from sqlalchemy.exc import IntegrityError

    for _ in range(5):
        t.task_no = _gen_task_no(db)
        db.add(t)
        try:
            d.status = 2  # 创建设备维修任务自动置维修中（§5.8）
            d.updated_by = user.id
            db.commit()
            db.refresh(t)
            return ok(_task_out(db, t))
        except IntegrityError as exc:
            db.rollback()
            if "uk_task_no" not in str(getattr(exc, "orig", None) or ""):
                raise BizError(E_PARAM, "任务保存失败，请重试（详情见系统日志）") from exc
    raise BizError(E_BILL_STATUS, "任务单号生成失败，请重试")


@router.post("/device-tasks/{task_id}/assign", dependencies=[Depends(require_permission("device:task"))])
def assign_device_task(task_id: int, req: AssignReq, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    t = _task_or_404(db, task_id)
    if (getattr(t, "dispatch_mode", "manual") or "manual") == "open" and t.status == "pending":
        raise BizError(E_PARAM, "公开任务单任务由维修人员自行领取，不可手动派发")
    assignee = db.get(SysUser, req.assignee_id)
    if assignee is None or assignee.status != 1:
        raise BizError(E_PARAM, "维修人员不存在或已停用")

    def _cb(db: Session, task, action, actor_id, actor_name):
        if action == "assign":
            _notify(db, task.assignee_id, "新设备维修任务",
                    f"设备任务 {task.task_no}「{task.title}」已派发给你。", "/device/tasks")

    transition(db, t, "assign", user.id, user.real_name, callbacks=[_cb], assignee_id=req.assignee_id)
    db.commit()
    return ok(_task_out(db, t))


@router.post("/device-tasks/{task_id}/claim", dependencies=[Depends(require_permission("device:task"))])
def claim_device_task(task_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """维修人员领取公开任务（open/hybrid 模式且未被领取时可用）。

    领取 = 自我指派：assignee_id=当前用户、状态 pending → assigned；通知其他调度员略。
    """
    t = _task_or_404(db, task_id)
    if (getattr(t, "dispatch_mode", "manual") or "manual") not in ("open", "hybrid"):
        raise BizError(E_PARAM, "该任务为指定派发，不支持自行领取")
    if t.status != "pending" or t.assignee_id:
        raise BizError(E_BILL_STATUS, "任务已被领取或不在待领取状态")
    if t.created_by == user.id and not _scope_all(db, user):
        raise BizError(E_PARAM, "不能领取自己创建的任务")

    def _cb(db: Session, task, action, actor_id, actor_name):
        # 通知创建者：任务已被领取
        if task.created_by and task.created_by != actor_id:
            _notify(db, task.created_by, "设备维修任务已被领取",
                    f"任务 {task.task_no}「{task.title}」已由 {actor_name} 领取。", "/device/tasks")

    transition(db, t, "assign", user.id, user.real_name, callbacks=[_cb], assignee_id=user.id)
    db.commit()
    return ok(_task_out(db, t))


@router.post("/device-tasks/{task_id}/status", dependencies=[Depends(require_any_permission("device:task", "device:manage"))])
def device_task_status(
    task_id: int,
    req: DeviceStatusReqT,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    t = _task_or_404(db, task_id)
    if req.action in ("verify", "reject", "close", "cancel") and not _scope_all(db, user):
        raise BizError(4005, "无权限（仅调度员可执行验收/关闭/取消）", http_status=403)
    if req.action in ("accept", "complete") and not _scope_all(db, user) and t.assignee_id != user.id:
        raise BizError(4005, "仅被指派人员可执行该操作", http_status=403)

    rollback_prompt = ""  # 回退文本提示词（verify/cancel 自动回退设备状态时生成）

    def _cb(db: Session, task, action, actor_id, actor_name):
        nonlocal rollback_prompt
        d = db.get(Device, task.device_id)
        if d is None:
            return
        if action == "complete":
            rec_cnt = db.scalar(select(func.count()).select_from(DeviceTaskRecord).where(DeviceTaskRecord.task_id == task.id)) or 0
            file_cnt = db.scalar(
                select(func.count()).select_from(DeviceTaskRecordFile)
                .join(DeviceTaskRecord, DeviceTaskRecord.id == DeviceTaskRecordFile.record_id)
                .where(DeviceTaskRecord.task_id == task.id)
            ) or 0
            if rec_cnt == 0 or file_cnt == 0:
                raise BizError(E_BILL_STATUS, "完成任务前必须填写维修记录并上传维修照片")
            _notify(db, task.assigned_by, "设备任务待验收",
                    f"设备任务 {task.task_no}「{task.title}」已完成，等待验收。", "/device/tasks")
        elif action in ("verify", "cancel"):
            # 验收通过/取消：按快照回退（无快照/快照异常回退在用）
            old_status, new_status = d.status, (task.previous_status if task.previous_status in (1, 3) else 1)
            d.status = new_status
            # 生成回退文本提示词：说明「维修中 → 快照前一状态」的自动回退
            rollback_prompt = (
                f"任务 {task.task_no}{'验收通过' if action == 'verify' else '已取消'}，"
                f"设备「{d.name}」（{d.code}）状态已自动回退："
                f"{STATUS_LABEL.get(old_status, old_status)} → {STATUS_LABEL.get(new_status, new_status)}"
                f"（快照前一状态：{STATUS_LABEL.get(task.previous_status, task.previous_status) if task.previous_status else '未知'}）"
            )
            if action == "verify":
                _notify(db, task.created_by or task.assigned_by, "设备状态已自动回退", rollback_prompt, "/device/tasks")
            else:
                _notify(db, task.assignee_id, "设备任务已取消",
                        f"设备任务 {task.task_no}「{task.title}」已被取消：{task.cancel_reason}", "/device/tasks")
                _notify(db, task.created_by, "设备状态已自动回退", rollback_prompt, "/device/tasks")
        # reject：保持维修中

    if req.action == "cancel" and module_enabled(db, "task"):
        # 已关联领用单的任务：需先取消/冲销领用（task_requisition 为 task 模块表；
        # task 模块未启用时设备任务不可能存在领用关联，直接跳过检查——无硬依赖）
        from app.modules.task.models import TaskRequisition

        link_cnt = db.scalar(select(func.count()).select_from(TaskRequisition).where(TaskRequisition.task_type == "device", TaskRequisition.task_id == t.id)) or 0
        if link_cnt:
            raise BizError(E_BILL_STATUS, "任务已关联领用单，请先取消领用再取消任务")
    transition(db, t, req.action, user.id, user.real_name, callbacks=[_cb],
               assignee_id=req.assignee_id or None, verdict=req.verdict, reason=req.reason)
    db.commit()
    return ok(_task_out(db, t, rollback_prompt=rollback_prompt))


# ============================ 设备维修记录 ============================

@router.get("/device-tasks/{task_id}/records", dependencies=[Depends(require_permission("device:task"))])
def list_device_records(task_id: int, db: Session = Depends(get_db)) -> dict:
    _task_or_404(db, task_id)
    rows = db.scalars(select(DeviceTaskRecord).where(DeviceTaskRecord.task_id == task_id).order_by(DeviceTaskRecord.id)).all()
    out = []
    for r in rows:
        files = db.scalars(select(DeviceTaskRecordFile).where(DeviceTaskRecordFile.record_id == r.id).order_by(DeviceTaskRecordFile.sort_order)).all()
        out.append({
            "id": r.id, "task_id": r.task_id, "content": r.content,
            "materials_used": json.loads(r.materials_used) if r.materials_used else [],
            "knowledge_snapshot": json.loads(r.knowledge_snapshot) if r.knowledge_snapshot else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "files": [{"id": f.id, "file_id": f.file_id, "category": f.category} for f in files],
        })
    return ok(out)


@router.post("/device-tasks/{task_id}/records", dependencies=[Depends(require_permission("device:task"))])
def create_device_record(task_id: int, req: DeviceRecordCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    t = _task_or_404(db, task_id)
    if t.status in TERMINAL_STATUS:
        raise BizError(E_BILL_STATUS, "终态任务不可追加记录")
    if not req.content and not req.files:
        raise BizError(E_PARAM, "记录内容与照片至少填写一项")
    r = DeviceTaskRecord(
        task_id=task_id, content=req.content,
        materials_used=json.dumps(req.materials_used, ensure_ascii=False) if req.materials_used else None,
        knowledge_snapshot=json.dumps(req.knowledge_snapshot, ensure_ascii=False) if req.knowledge_snapshot else None,
        created_by=user.id,
    )
    db.add(r)
    db.flush()
    for i, f in enumerate(req.files):
        db.add(DeviceTaskRecordFile(record_id=r.id, file_id=f.file_id, category=f.category, sort_order=i, created_by=user.id))
    db.commit()
    return ok({"id": r.id})


# ============================ 设备任务领用（复用 task_requisition 链接表） ============================

@router.get("/device-tasks/{task_id}/requisitions", dependencies=[Depends(require_permission("device:task"))])
def device_task_requisitions(task_id: int, db: Session = Depends(get_db)) -> dict:
    _task_or_404(db, task_id)
    _task_module_guard(db)
    from app.modules.task.models import TaskRequisition

    links = db.scalars(select(TaskRequisition).where(TaskRequisition.task_type == "device", TaskRequisition.task_id == task_id)).all()
    req_ids = [l.requisition_id for l in links]
    rows = []
    if req_ids:
        from app.models import OutRequisition

        for r in db.scalars(select(OutRequisition).where(OutRequisition.id.in_(req_ids))).all():
            rows.append({"id": r.id, "bill_no": r.bill_no, "status": r.status, "use_location": r.use_location, "total_qty": str(r.total_qty)})
    return ok(rows)


@router.post("/device-tasks/{task_id}/requisitions", dependencies=[Depends(require_permission("device:task"))])
def create_device_requisition(task_id: int, req: DeviceRequisitionReq, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """设备任务领用：复用领用流程 + task_requisition(task_type='device') 链接（同事务）。

    增强功能：需 task 模块已启用（task_requisition 链接表属 task 模块）。
    """
    t = _task_or_404(db, task_id)
    if t.status in TERMINAL_STATUS:
        raise BizError(E_BILL_STATUS, "终态任务不可发起领用")
    _task_module_guard(db)
    if not req.items:
        raise BizError(E_PARAM, "至少选择一项物料")
    if len(req.items) > 50:
        raise BizError(E_PARAM, "单次最多 50 项")
    from sqlalchemy.exc import IntegrityError

    from app.models import OutRequisition
    from app.models.base import BaseLocation, BaseProduct, BaseWarehouse
    from app.models.requisition import OutRequisitionItem
    from app.modules.task.models import TaskRequisition
    from app.services.stock import bill_no_conflict

    if db.get(BaseWarehouse, req.warehouse_id) is None:
        raise BizError(E_PARAM, "仓库不存在")
    for attempt in range(5):
        bill = OutRequisition(
            bill_no="", applicant_id=user.id, use_location=req.use_location, use_reason=req.use_reason,
            is_private=0, display_reason="", display_location="", location_photo_file_id=0,
            warehouse_id=req.warehouse_id, status=req_api.REQ_STATUS_WORKING, remark=req.remark,
        )
        bill.bill_no = req_api.generate_bill_no(db, "LL", OutRequisition)
        db.add(bill)
        db.flush()
        try:
            total = 0.0
            for idx, item in enumerate(req.items):
                product_id = int(item.get("product_id") or 0)
                qty = str(item.get("qty") or "")
                location_id = int(item.get("location_id") or 0)
                if product_id <= 0 or location_id <= 0 or not qty:
                    raise BizError(E_PARAM, "物料/库位/数量必填")
                if db.get(BaseProduct, product_id) is None:
                    raise BizError(E_NOT_FOUND, f"商品 id={product_id} 不存在")
                if db.get(BaseLocation, location_id) is None:
                    raise BizError(E_NOT_FOUND, f"库位 id={location_id} 不存在")
                db.add(OutRequisitionItem(
                    requisition_id=bill.id, product_id=product_id, qty=qty,
                    location_id=location_id, photo_file_id=int(item.get("photo_file_id") or 0), sort=idx,
                ))
                total += float(qty)
            bill.total_qty = total
            shortages = req_api._deduct_items(db, bill, user.id)
            db.add(TaskRequisition(task_type="device", task_id=t.id, requisition_id=bill.id, created_by=user.id))
            db.commit()
            return ok({"id": bill.id, "bill_no": bill.bill_no, "status": bill.status, "shortages": shortages})
        except IntegrityError as exc:
            db.rollback()
            if not bill_no_conflict(exc):
                raise BizError(E_PARAM, "领用单保存失败，请重试（详情见系统日志）") from exc
        except BizError:
            db.rollback()
            raise
    raise BizError(E_BILL_STATUS, "单据编号生成失败，请重试")
