"""task 模块接口（维修任务/派发/看板/维修记录/领用关联/知识推荐/统一任务池，方案 §6.3）。

router 级依赖：require_module_enabled("task")；依赖 cable 模块（启用时校验，运行期 cable 操作
再经 require_module_enabled("cable") 兜底 403）。
数据范围（§8.3）：调度员/超管/管理者 ALL；维修人员 ASSIGNED（仅被指派任务）。

v1.2 统一任务池联动视图：
- GET /tasks/pool 合并「线缆维修任务 + 设备维修任务（device 模块启用时）」，供看板/列表合并显示；
- 故障状态与任务态全程联动：待派发›已派发›进行中›完成待验›已验证›已关闭；
- 任务条目携带关联信息（故障摘要/设备摘要），前端可直接查看、跳转对应模块。
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
from app.modules.cable.services.fault_sync import (
    FAULT_DISPATCHED,
    FAULT_PENDING,
    FAULT_PROCESSING,
    FAULT_TO_VERIFY,
    FAULT_VERIFIED,
    fault_briefs,
    set_fault_status,
)
from app.modules.task.models import MaintenanceTask, TaskRecord, TaskRecordFile, TaskRequisition
from app.modules.task.schemas import AssignReq, RecordCreate, StatusReq, TaskCreate, TaskRequisitionReq, TaskUpdate

logger = logging.getLogger("app.task")

router = APIRouter(tags=["维修任务"], dependencies=[Depends(get_current_user), Depends(require_module_enabled("task"))])

ALL_SCOPE_ROLES = (SUPER_ADMIN_ROLE_CODE, "manager", "dispatcher")


def _cable_guard(db: Session) -> None:
    """cable 模块运行期兜底（依赖模块停用 → 相关数据操作 403）。"""
    if not module_enabled(db, "cable"):
        raise BizError(4009, "依赖模块 cable 未启用", http_status=403)


def _scope_all(db: Session, user: SysUser) -> bool:
    role = db.get(SysRole, user.role_id)
    return (role.code if role else "") in ALL_SCOPE_ROLES


def _task_or_404(db: Session, task_id: int) -> MaintenanceTask:
    t = db.get(MaintenanceTask, task_id)
    if t is None:
        raise BizError(E_NOT_FOUND, "任务不存在")
    return t


def _notify(db: Session, user_id: int, title: str, content: str, link: str, biz_type: str = "待办") -> None:
    if not user_id:
        return
    db.add(SysNotification(user_id=user_id, title=title, content=content, biz_type=biz_type, link=link))


def _link_info(db: Session, t: MaintenanceTask) -> dict:
    """任务关联信息（联动视图）：故障摘要 + 线缆名称；cable 模块不可用时为空壳。"""
    info = {"fault_type": "", "fault_status": None, "severity": None, "cable_id": t.cable_id, "cable_name": ""}
    if not (t.fault_id or t.cable_id) or not module_enabled(db, "cable"):
        return info
    try:
        from app.modules.cable.models import Cable
        from app.modules.cable.services.fault_sync import FAULT_STATUS_LABELS

        if t.fault_id:
            brief = fault_briefs(db, [t.fault_id]).get(t.fault_id)
            if brief:
                info.update({
                    "fault_type": brief["fault_type"],
                    "fault_status": brief["status"],
                    "fault_status_label": FAULT_STATUS_LABELS.get(brief["status"], str(brief["status"])),
                    "severity": brief["severity"],
                })
                if brief.get("cable_id") and not t.cable_id:
                    info["cable_id"] = brief["cable_id"]
        if info["cable_id"]:
            c = db.get(Cable, info["cable_id"])
            if c is not None:
                info["cable_name"] = c.name
    except Exception:  # noqa: BLE001 关联信息失败不阻断任务主数据
        logger.warning("任务 %s 关联信息读取失败", t.id, exc_info=True)
    return info


def _task_out(db: Session, t: MaintenanceTask) -> dict:
    assignee = db.get(SysUser, t.assignee_id) if t.assignee_id else None
    creator = db.get(SysUser, t.created_by) if t.created_by else None
    out = {
        "id": t.id,
        "task_no": t.task_no,
        "cable_id": t.cable_id,
        "fault_id": t.fault_id,
        "title": t.title,
        "description": t.description,
        "assignee_id": t.assignee_id,
        "assignee_name": assignee.real_name if assignee else "",
        "status": t.status,
        "priority": t.priority,
        "scheduled_time": t.scheduled_time.isoformat() if t.scheduled_time else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "verdict": t.verdict,
        "cancel_reason": t.cancel_reason,
        "created_by": t.created_by,
        "creator_name": creator.real_name if creator else "",
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    out.update(_link_info(db, t))
    return out


def _gen_task_no(db: Session) -> str:
    """任务单号：WX + 日期 + 当日序号（并发重试）。"""
    from app.services.stock import generate_bill_no

    for _ in range(5):
        no = generate_bill_no(db, "WX", MaintenanceTask, field="task_no")
        if no:
            return no
    raise BizError(E_BILL_STATUS, "任务单号生成失败，请重试")


# ============================ 任务 CRUD ============================

def _archived_filter(stmt, archived: int):
    """归档过滤（已关闭自动归档）：archived=1 仅终态（closed/cancelled）；=0 排除终态。

    显式指定单个 status 时不过滤（前端状态下拉可直达）。"""
    if archived:
        return stmt.where(MaintenanceTask.status.in_(TERMINAL_STATUS))
    return stmt.where(MaintenanceTask.status.notin_(TERMINAL_STATUS))


@router.get("/tasks", dependencies=[Depends(require_any_permission("task:dispatch", "task:process"))])
def list_tasks(
    status: str = "",
    keyword: str = "",
    archived: int = Query(0, ge=0, le=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(MaintenanceTask)
    if not _scope_all(db, user):
        stmt = stmt.where(MaintenanceTask.assignee_id == user.id)
    if status:
        stmt = stmt.where(MaintenanceTask.status == status)
    else:
        stmt = _archived_filter(stmt, archived)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(MaintenanceTask.task_no.like(like) | MaintenanceTask.title.like(like))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(MaintenanceTask.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({"total": total, "page": page, "page_size": page_size, "items": [_task_out(db, t) for t in rows]})


@router.post("/tasks", dependencies=[Depends(require_permission("task:dispatch"))])
def create_task(req: TaskCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if req.cable_id or req.fault_id:
        _cable_guard(db)
    if req.fault_id:
        # 唯一活跃任务约束：同一 fault 最多一个非终态任务（应用层校验）
        active = db.scalar(
            select(func.count()).select_from(MaintenanceTask).where(
                MaintenanceTask.fault_id == req.fault_id,
                MaintenanceTask.status.in_(ACTIVE_STATUSES),
            )
        )
        if active:
            raise BizError(E_BILL_STATUS, "该故障已存在未完结任务，禁止重复创建")
        from app.modules.cable.models import CableFault

        if db.get(CableFault, req.fault_id) is None:
            raise BizError(E_NOT_FOUND, "故障不存在")
    t = MaintenanceTask(
        task_no="", cable_id=req.cable_id, fault_id=req.fault_id, title=req.title,
        description=req.description, priority=req.priority, scheduled_time=req.scheduled_time,
        created_by=user.id, status="pending",
    )
    from sqlalchemy.exc import IntegrityError

    for _ in range(5):
        t.task_no = _gen_task_no(db)
        db.add(t)
        try:
            db.commit()
            db.refresh(t)
            return ok(_task_out(db, t))
        except IntegrityError as exc:
            db.rollback()
            if "uk_task_no" not in str(getattr(exc, "orig", None) or ""):
                raise BizError(E_PARAM, "任务保存失败，请重试（详情见系统日志）") from exc
    raise BizError(E_BILL_STATUS, "任务单号生成失败，请重试")


# ============================ 统一任务池（联动视图） ============================

def _device_pool_items(db: Session, user: SysUser, status: str, keyword: str, archived: int = 0) -> list[dict]:
    """设备维修任务池条目（device 模块启用时；跨模块经模型懒加载 + 启用门控）。"""
    if not module_enabled(db, "device"):
        return []
    try:  # 懒加载 device 模块模型（未部署时任务池自动降级为纯线缆任务）
        from app.modules.device.models import Device, DeviceTask
    except ImportError:
        return []
    stmt = select(DeviceTask)
    if not _scope_all(db, user):
        stmt = stmt.where(DeviceTask.assignee_id == user.id)
    if status:
        stmt = stmt.where(DeviceTask.status == status)
    elif archived:
        stmt = stmt.where(DeviceTask.status.in_(TERMINAL_STATUS))
    else:
        stmt = stmt.where(DeviceTask.status.notin_(TERMINAL_STATUS))
    rows = db.scalars(stmt.order_by(DeviceTask.id.desc()).limit(500)).all()
    items = []
    for t in rows:
        d = db.get(Device, t.device_id)
        if keyword and keyword not in (t.task_no or "") and keyword not in (t.title or "") \
                and (d is None or (keyword not in (d.name or "") and keyword not in (d.code or ""))):
            continue
        assignee = db.get(SysUser, t.assignee_id) if t.assignee_id else None
        creator = db.get(SysUser, t.created_by) if t.created_by else None
        items.append({
            "source": "device",
            "key": f"d{t.id}",
            "id": t.id,
            "task_no": t.task_no,
            "title": t.title,
            "description": t.description,
            "status": t.status,
            "priority": t.priority,
            "assignee_id": t.assignee_id,
            "assignee_name": assignee.real_name if assignee else "",
            "scheduled_time": t.scheduled_time.isoformat() if t.scheduled_time else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            "verdict": t.verdict,
            "cancel_reason": t.cancel_reason,
            "creator_name": creator.real_name if creator else "",
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "dispatch_mode": getattr(t, "dispatch_mode", "manual") or "manual",
            # 设备关联信息（直接查看/跳转设备维修任务）
            "fault_id": None, "fault_type": "", "fault_status": None, "severity": None,
            "cable_id": None, "cable_name": "",
            "device_id": t.device_id,
            "device_name": d.name if d else "",
            "device_code": d.code if d else "",
            "device_status": d.status if d else None,
            "previous_status": t.previous_status,
        })
    return items


@router.get("/tasks/pool", dependencies=[Depends(require_any_permission("task:dispatch", "task:process"))])
def task_pool(
    status: str = "",
    keyword: str = "",
    source: str = "",
    archived: int = Query(0, ge=0, le=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """统一维修任务池：线缆维修任务 + 设备维修任务合并视图（联动视图数据源）。

    - device 模块启用时合并设备维修任务（「添加设备管理到任务池系统」）；
    - 每条目携带关联信息：线缆任务带故障摘要（类型/状态/严重度/线缆名），设备任务带设备摘要；
    - source 过滤：cable=仅线缆任务，device=仅设备任务，空=全部；
    - archived：0=仅活动任务（默认，已关闭自动归档），1=仅归档（closed/cancelled）。
    """
    kw = keyword.strip()
    cable_rows: list[MaintenanceTask] = []
    if source in ("", "cable"):
        stmt = select(MaintenanceTask)
        if not _scope_all(db, user):
            stmt = stmt.where(MaintenanceTask.assignee_id == user.id)
        if status:
            stmt = stmt.where(MaintenanceTask.status == status)
        else:
            stmt = _archived_filter(stmt, archived)
        cable_rows = list(db.scalars(stmt.order_by(MaintenanceTask.id.desc()).limit(500)).all())

    # 批量取故障摘要（一次查询；cable 未启用时保持空壳关联信息）
    fault_ids = [t.fault_id for t in cable_rows if t.fault_id]
    briefs = fault_briefs(db, fault_ids) if (fault_ids and module_enabled(db, "cable")) else {}
    cable_names: dict[int, str] = {}
    if module_enabled(db, "cable"):
        try:
            from app.modules.cable.models import Cable

            cable_ids = {t.cable_id for t in cable_rows if t.cable_id} | {b["cable_id"] for b in briefs.values() if b.get("cable_id")}
            cable_ids.discard(None)
            if cable_ids:
                cable_names = {c.id: c.name for c in db.scalars(select(Cable).where(Cable.id.in_(cable_ids))).all()}
        except Exception:  # noqa: BLE001 关联信息失败不阻断任务主数据
            logger.warning("任务池线缆名称批量读取失败", exc_info=True)

    items: list[dict] = []
    for t in cable_rows:
        if kw and kw not in (t.task_no or "") and kw not in (t.title or ""):
            continue
        assignee = db.get(SysUser, t.assignee_id) if t.assignee_id else None
        creator = db.get(SysUser, t.created_by) if t.created_by else None
        brief = briefs.get(t.fault_id or 0)
        cid = t.cable_id or (brief or {}).get("cable_id")
        items.append({
            "source": "cable",
            "key": f"c{t.id}",
            "id": t.id,
            "task_no": t.task_no,
            "title": t.title,
            "description": t.description,
            "status": t.status,
            "priority": t.priority,
            "assignee_id": t.assignee_id,
            "assignee_name": assignee.real_name if assignee else "",
            "scheduled_time": t.scheduled_time.isoformat() if t.scheduled_time else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            "verdict": t.verdict,
            "cancel_reason": t.cancel_reason,
            "creator_name": creator.real_name if creator else "",
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "dispatch_mode": "manual",
            # 线缆故障关联信息（直接查看/跳转故障管理）
            "fault_id": t.fault_id,
            "fault_type": (brief or {}).get("fault_type", ""),
            "fault_status": (brief or {}).get("status"),
            "severity": (brief or {}).get("severity"),
            "cable_id": cid,
            "cable_name": cable_names.get(cid, "") if cid else "",
            "device_id": None, "device_name": "", "device_code": "", "device_status": None,
            "previous_status": None,
        })

    if source in ("", "device"):
        items.extend(_device_pool_items(db, user, status, kw, archived))

    items.sort(key=lambda x: (x.get("created_at") or "", x.get("id") or 0), reverse=True)
    total = len(items)
    paged = items[(page - 1) * page_size: page * page_size]
    return ok({"total": total, "page": page, "page_size": page_size, "items": paged})


@router.get("/tasks/{task_id}", dependencies=[Depends(require_permission("task:dispatch"))])
def get_task(task_id: int, db: Session = Depends(get_db)) -> dict:
    t = _task_or_404(db, task_id)
    return ok(_task_out(db, t))


@router.post("/tasks/auto-link", dependencies=[Depends(require_permission("task:dispatch"))])
def auto_link_tasks(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """历史未关联任务自动关联：孤儿任务（fault_id 空 + cable_id 非空）按确定性规则补挂同线缆故障。

    规则：候选故障须同线缆/未关闭/未被占用且上报时间晚于任务创建时间；挂接后通知创建人核实。
    模块启用时（on_enable 钩子）自动执行一次；本端点供手动补跑。幂等：无孤儿即空结果。
    """
    from app.modules.task.services.auto_link import auto_link_orphan_tasks

    linked = auto_link_orphan_tasks(db, notify=_notify)
    db.commit()
    return ok({"linked": len(linked), "items": linked})


@router.put("/tasks/{task_id}", dependencies=[Depends(require_permission("task:dispatch"))])
def update_task(task_id: int, req: TaskUpdate, db: Session = Depends(get_db)) -> dict:
    t = _task_or_404(db, task_id)
    if t.status in TERMINAL_STATUS:
        raise BizError(E_BILL_STATUS, "终态任务不可编辑")
    for k, v in req.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    db.commit()
    return ok(_task_out(db, t))


# ============================ 派发 / 状态流转 ============================

@router.post("/tasks/{task_id}/assign", dependencies=[Depends(require_permission("task:dispatch"))])
def assign_task(task_id: int, req: AssignReq, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    t = _task_or_404(db, task_id)
    assignee = db.get(SysUser, req.assignee_id)
    if assignee is None or assignee.status != 1:
        raise BizError(E_PARAM, "维修人员不存在或已停用")

    def _cb(db: Session, task, action, actor_id, actor_name):
        if action == "assign":
            # 故障联动：待派发(0) → 已派发(1)（看板/列表/故障管理三处同步展示）
            set_fault_status(db, task.fault_id, FAULT_DISPATCHED)
            _notify(db, task.assignee_id, "新维修任务",
                    f"任务 {task.task_no}「{task.title}」已派发给你，请及时处理。",
                    f"/task/board", biz_type="待办")

    transition(db, t, "assign", user.id, user.real_name, callbacks=[_cb], assignee_id=req.assignee_id)
    db.commit()
    return ok(_task_out(db, t))


@router.post("/tasks/{task_id}/status", dependencies=[Depends(require_any_permission("task:process", "task:verify", "task:dispatch"))])
def task_status(
    task_id: int,
    req: StatusReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    t = _task_or_404(db, task_id)
    # 动作权限：验收/驳回=task:verify；关闭/取消=task:dispatch；接单/完成=task:process（被指派者）
    if req.action in ("verify", "reject", "close", "cancel"):
        if not _scope_all(db, user):
            raise BizError(4005, "无权限（仅调度员可执行验收/关闭/取消）", http_status=403)
    if req.action in ("accept", "complete") and not _scope_all(db, user) and t.assignee_id != user.id:
        raise BizError(4005, "仅被指派人员可执行该操作", http_status=403)

    def _cb(db: Session, task, action, actor_id, actor_name):
        if action == "accept":
            # 故障联动：已派发(1) → 进行中(2)
            set_fault_status(db, task.fault_id, FAULT_PROCESSING)
        elif action == "complete":
            # cable 依赖兜底：故障联动需要 cable 模块可用
            if task.fault_id and not module_enabled(db, "cable"):
                raise BizError(4009, "依赖模块 cable 未启用，无法联动故障状态", http_status=403)
            # 必填维修记录+照片
            rec_cnt = db.scalar(select(func.count()).select_from(TaskRecord).where(TaskRecord.task_id == task.id)) or 0
            file_cnt = db.scalar(
                select(func.count()).select_from(TaskRecordFile)
                .join(TaskRecord, TaskRecord.id == TaskRecordFile.record_id)
                .where(TaskRecord.task_id == task.id)
            ) or 0
            if rec_cnt == 0 or file_cnt == 0:
                raise BizError(E_BILL_STATUS, "完成任务前必须填写维修记录并上传维修照片")
            set_fault_status(db, task.fault_id, FAULT_TO_VERIFY)
            _notify(db, task.assigned_by, "任务待验收",
                    f"任务 {task.task_no}「{task.title}」已完成，等待验收。", f"/task/board")
        elif action == "verify":
            set_fault_status(db, task.fault_id, FAULT_VERIFIED)
        elif action == "reject":
            set_fault_status(db, task.fault_id, FAULT_PROCESSING)
        elif action == "cancel":
            set_fault_status(db, task.fault_id, FAULT_PENDING)
            _notify(db, task.assignee_id, "任务已取消",
                    f"任务 {task.task_no}「{task.title}」已被取消：{task.cancel_reason}", f"/task/board")
        # complete 回调开头已做依赖兜底（cable 模块停用时 403）

    if req.action == "cancel":
        # 已关联领用单的任务：需先取消/冲销领用，禁止直接取消（方案 §13.2）
        link_cnt = db.scalar(select(func.count()).select_from(TaskRequisition).where(TaskRequisition.task_type == "cable", TaskRequisition.task_id == t.id)) or 0
        if link_cnt:
            raise BizError(E_BILL_STATUS, "任务已关联领用单，请先取消领用再取消任务")
    transition(
        db, t, req.action, user.id, user.real_name,
        callbacks=[_cb],
        assignee_id=req.assignee_id or None,
        verdict=req.verdict, reason=req.reason,
    )
    db.commit()
    return ok(_task_out(db, t))


# ============================ 维修记录 ============================

def _record_out(r: TaskRecord, files: list[TaskRecordFile]) -> dict:
    return {
        "id": r.id,
        "task_id": r.task_id,
        "content": r.content,
        "materials_used": json.loads(r.materials_used) if r.materials_used else [],
        "knowledge_snapshot": json.loads(r.knowledge_snapshot) if r.knowledge_snapshot else None,
        "created_by": r.created_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "files": [{"id": f.id, "file_id": f.file_id, "category": f.category, "remark": f.remark} for f in files],
    }


@router.get("/tasks/{task_id}/records", dependencies=[Depends(require_permission("task:process"))])
def list_records(task_id: int, db: Session = Depends(get_db)) -> dict:
    _task_or_404(db, task_id)
    rows = db.scalars(select(TaskRecord).where(TaskRecord.task_id == task_id).order_by(TaskRecord.id)).all()
    out = []
    for r in rows:
        files = db.scalars(select(TaskRecordFile).where(TaskRecordFile.record_id == r.id).order_by(TaskRecordFile.sort_order)).all()
        out.append(_record_out(r, list(files)))
    return ok(out)


@router.post("/tasks/{task_id}/records", dependencies=[Depends(require_permission("task:process"))])
def create_record(task_id: int, req: RecordCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    t = _task_or_404(db, task_id)
    if t.status in TERMINAL_STATUS:
        raise BizError(E_BILL_STATUS, "终态任务不可追加记录")
    if not req.content and not req.files:
        raise BizError(E_PARAM, "记录内容与照片至少填写一项")
    r = TaskRecord(
        task_id=task_id, content=req.content,
        materials_used=json.dumps(req.materials_used, ensure_ascii=False) if req.materials_used else None,
        knowledge_snapshot=json.dumps(req.knowledge_snapshot, ensure_ascii=False) if req.knowledge_snapshot else None,
        created_by=user.id,
    )
    db.add(r)
    db.flush()
    for i, f in enumerate(req.files):
        db.add(TaskRecordFile(record_id=r.id, file_id=f.file_id, category=f.category, remark=f.remark, sort_order=i, created_by=user.id))
    db.commit()
    return ok({"id": r.id})


# ============================ 任务领用（复用领用体系） ============================

@router.get("/tasks/{task_id}/requisitions", dependencies=[Depends(require_permission("task:dispatch"))])
def task_requisitions(task_id: int, db: Session = Depends(get_db)) -> dict:
    _task_or_404(db, task_id)
    links = db.scalars(select(TaskRequisition).where(TaskRequisition.task_type == "cable", TaskRequisition.task_id == task_id)).all()
    req_ids = [l.requisition_id for l in links]
    rows = []
    if req_ids:
        from app.models import OutRequisition

        for r in db.scalars(select(OutRequisition).where(OutRequisition.id.in_(req_ids))).all():
            rows.append({"id": r.id, "bill_no": r.bill_no, "status": r.status, "use_location": r.use_location, "total_qty": str(r.total_qty)})
    return ok(rows)


@router.post("/tasks/{task_id}/requisitions", dependencies=[Depends(require_permission("task:dispatch"))])
def create_task_requisition(task_id: int, req: TaskRequisitionReq, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """发起领用：复用领用流程（提交即出库）——同事务创建 out_requisition + task_requisition 链接。

    领用明细/库存扣减复用 app.api.requisition 的既有实现（_deduct_items 走 post_stock_change 铁律），
    不新建并行领用体系（方案 §0）。
    """
    t = _task_or_404(db, task_id)
    if t.status in TERMINAL_STATUS:
        raise BizError(E_BILL_STATUS, "终态任务不可发起领用")
    if not req.items:
        raise BizError(E_PARAM, "至少选择一项物料")
    if len(req.items) > 50:
        raise BizError(E_PARAM, "单次最多 50 项")
    from sqlalchemy.exc import IntegrityError

    from app.models import OutRequisition
    from app.models.base import BaseLocation, BaseProduct, BaseWarehouse
    from app.models.requisition import OutRequisitionItem
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
            db.add(TaskRequisition(task_type="cable", task_id=t.id, requisition_id=bill.id, created_by=user.id))
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


# ============================ 知识推荐（P4 后联调） ============================

@router.post("/tasks/{task_id}/knowledge-recommend", dependencies=[Depends(require_permission("task:process"))])
def knowledge_recommend(task_id: int, db: Session = Depends(get_db)) -> dict:
    """任务知识推荐：knowledge 模块启用时按任务标题/描述/故障类型检索已发布知识（RAG-lite）。"""
    t = _task_or_404(db, task_id)
    if not module_enabled(db, "knowledge"):
        return ok({"items": [], "message": "知识库模块未启用，暂无可推荐知识"})
    from app.modules.knowledge.services.article_search import search_articles

    # 关键词：故障类型优先，其次任务标题/描述
    keywords: list[str] = []
    if t.fault_id:
        from app.modules.cable.models import CableFault

        fault = db.get(CableFault, t.fault_id)
        if fault and fault.fault_type:
            keywords.append(fault.fault_type)
    for text in (t.title, t.description):
        if text:
            keywords.append(text[:30])
    items: list[dict] = []
    seen: set[int] = set()
    for kw in keywords:
        for item in search_articles(db, kw, 5):
            if item["id"] not in seen:
                seen.add(item["id"])
                items.append(item)
        if len(items) >= 5:
            break
    return ok({"items": items[:5], "message": ""})
