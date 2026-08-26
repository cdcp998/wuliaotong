"""cable 模块接口（线缆/故障/测距导航，方案 §6.2）。

router 级依赖：require_module_enabled("cable")——模块未启用时全部接口 403（方案 §13.1.2）。
地图部分（图源/瓦片代理/缓存区域）已拆分至独立 map 模块（依赖本模块）。
数据范围（方案 §8.3）：调度员/超管/管理者 ALL；其他角色故障数据仅本人上报（OWN+ASSIGNED 中
ASSIGNED 部分随 task 模块实现）。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from uuid import uuid4

from app.core.deps import SUPER_ADMIN_ROLE_CODE, get_current_user, require_any_permission, require_permission
from app.core.modules import require_module_enabled
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models import SysRole, SysUser
from app.modules.cable.models import Cable, CableFault, CableMarker, CablePoint, FaultFile
from app.modules.cable.schemas import (
    CableCreate,
    CableUpdate,
    FaultCreate,
    FaultPhotoIn,
    FaultStatusUpdate,
    FaultUpdate,
    MarkerCreate,
    MeasureReq,
    NavigateReq,
    PointsUpdate,
    StatusUpdate,
)
from app.modules.cable.services import geo_math
from app.modules.cable.services.fault_sync import (
    FAULT_ACTIVE_STATUSES,
    FAULT_CLOSED,
    FAULT_STATUS_LABELS,
)

logger = logging.getLogger("app.cable")

router = APIRouter(tags=["线缆管理"], dependencies=[Depends(get_current_user), Depends(require_module_enabled("cable"))])

ALL_SCOPE_ROLES = (SUPER_ADMIN_ROLE_CODE, "manager", "dispatcher")


# ============================ 工具 ============================

def _user_scope(db: Session, user: SysUser) -> tuple[str, list[int]]:
    """返回 (scope, 相关角色 id 列表)。scope: ALL / OWN。"""
    role = db.get(SysRole, user.role_id)
    code = role.code if role else ""
    if code in ALL_SCOPE_ROLES:
        return "ALL", []
    return "OWN", [user.id]


def _cable_out(c: Cable, points: list[CablePoint] | None = None) -> dict:
    geo = json.loads(c.geometry) if c.geometry else None
    out = {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "type": c.type,
        "total_length": float(c.total_length),
        "geometry": geo,
        "status": c.status,
        "description": c.description,
        "created_by": c.created_by,
        "updated_by": c.updated_by,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
    if points is not None:
        out["points"] = [
            {
                "seq": p.seq,
                "lat": float(p.lat),
                "lng": float(p.lng),
                "cumulative_distance": float(p.cumulative_distance),
                "label": p.label,
            }
            for p in points
        ]
    return out


def _linked_tasks_by_fault(db: Session, fault_ids: list[int]) -> dict[int, list[dict]]:
    """故障 → 反向关联的维修任务列表（task 模块启用时；统一联动视图用）。

    task 模块未安装/未启用时返回空映射（线缆管理独立运行，不依赖任务管理）。
    """
    ids = [int(i) for i in fault_ids if i]
    if not ids:
        return {}
    from app.core.modules import module_enabled

    if not module_enabled(db, "task"):
        return {}
    try:  # 懒加载 task 模块模型（模块未部署时不影响 cable 独立运行）
        from app.modules.task.models import MaintenanceTask
    except ImportError:
        return {}
    rows = db.scalars(select(MaintenanceTask).where(MaintenanceTask.fault_id.in_(ids)).order_by(MaintenanceTask.id.desc())).all()
    out: dict[int, list[dict]] = {}
    for t in rows:
        if t.fault_id is None:
            continue
        out.setdefault(t.fault_id, []).append({
            "id": t.id, "task_no": t.task_no, "title": t.title,
            "status": t.status, "assignee_id": t.assignee_id,
        })
    return out


def _fault_out(f: CableFault, linked_tasks: list[dict] | None = None) -> dict:
    out = {
        "id": f.id,
        "cable_id": f.cable_id,
        "lat": float(f.lat),
        "lng": float(f.lng),
        "cumulative_distance": float(f.cumulative_distance),
        "fault_type": f.fault_type,
        "severity": f.severity,
        "description": f.description,
        "status": f.status,
        "status_label": FAULT_STATUS_LABELS.get(f.status, str(f.status)),
        "reported_by": f.reported_by,
        "reported_at": f.reported_at.isoformat() if f.reported_at else None,
        "photos_note": f.photos_note,
        # 反向关联：该故障对应的维修任务（看板/列表跳转源；task 未启用时为空数组）
        "linked_tasks": linked_tasks or [],
    }
    return out


def _rebuild_points(db: Session, cable: Cable, coords: list[tuple[float, float]]) -> list[CablePoint]:
    """重建线缆路径点（计算累计距离 + geometry），返回点列表。"""
    dists = geo_math.cumulative_distances(coords)
    db.query(CablePoint).filter(CablePoint.cable_id == cable.id).delete()
    points = []
    for i, (lat, lng) in enumerate(coords):
        p = CablePoint(
            cable_id=cable.id, seq=i + 1, lat=lat, lng=lng,
            cumulative_distance=round(dists[i], 2),
        )
        db.add(p)
        points.append(p)
    cable.total_length = round(dists[-1], 2)
    geojson = {"type": "LineString", "coordinates": [[lng, lat] for lat, lng in coords]}
    cable.geometry = json.dumps(geojson, ensure_ascii=False)
    db.flush()
    return points


def _cable_or_404(db: Session, cable_id: int) -> Cable:
    c = db.get(Cable, cable_id)
    if c is None:
        raise BizError(E_NOT_FOUND, "线缆不存在")
    return c


# ============================ 线缆 ============================

@router.get("/cables/export", dependencies=[Depends(require_permission("cable:view"))])
def export_cables(db: Session = Depends(get_db)) -> dict:
    """导出全部在用/停用线缆为 GeoJSON FeatureCollection（WGS84）。"""
    rows = db.scalars(select(Cable).where(Cable.status.in_([0, 1])).order_by(Cable.id)).all()
    features = []
    for c in rows:
        geo = json.loads(c.geometry) if c.geometry else None
        features.append({
            "type": "Feature",
            "properties": {
                "id": c.id, "code": c.code, "name": c.name, "type": c.type,
                "status": c.status, "total_length": float(c.total_length),
                "description": c.description,
            },
            "geometry": geo or {"type": "LineString", "coordinates": []},
        })
    return ok({"type": "FeatureCollection", "features": features})


@router.get("/cables", dependencies=[Depends(require_permission("cable:view"))])
def list_cables(
    keyword: str = "",
    type: str = "",
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Cable)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(or_(Cable.code.like(like), Cable.name.like(like)))
    if type:
        stmt = stmt.where(Cable.type == type)
    if status:
        stmt = stmt.where(Cable.status == int(status))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Cable.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({
        "total": total, "page": page, "page_size": page_size,
        "items": [_cable_out(c) for c in rows],
    })


@router.get("/cables/{cable_id}", dependencies=[Depends(require_permission("cable:view"))])
def get_cable(cable_id: int, db: Session = Depends(get_db)) -> dict:
    c = _cable_or_404(db, cable_id)
    points = db.scalars(select(CablePoint).where(CablePoint.cable_id == cable_id).order_by(CablePoint.seq)).all()
    return ok(_cable_out(c, list(points)))


@router.post("/cables", dependencies=[Depends(require_permission("cable:manage"))])
def create_cable(req: CableCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    exists = db.scalar(select(Cable.id).where(Cable.code == req.code))
    if exists:
        raise BizError(E_PARAM, "线缆编码已存在")
    c = Cable(
        code=req.code, name=req.name, type=req.type, status=req.status,
        description=req.description, created_by=user.id, updated_by=user.id,
    )
    db.add(c)
    db.flush()
    coords = [(p.lat, p.lng) for p in req.points]
    _rebuild_points(db, c, coords)
    db.commit()
    db.refresh(c)
    return ok(_cable_out(c))


@router.put("/cables/{cable_id}", dependencies=[Depends(require_permission("cable:manage"))])
def update_cable(cable_id: int, req: CableUpdate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    c = _cable_or_404(db, cable_id)
    for k, v in req.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    c.updated_by = user.id
    db.commit()
    return ok(_cable_out(c))


@router.post("/cables/{cable_id}/points", dependencies=[Depends(require_permission("cable:manage"))])
def update_points(cable_id: int, req: PointsUpdate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    c = _cable_or_404(db, cable_id)
    coords = [(p.lat, p.lng) for p in req.points]
    _rebuild_points(db, c, coords)
    c.updated_by = user.id
    db.commit()
    points = db.scalars(select(CablePoint).where(CablePoint.cable_id == cable_id).order_by(CablePoint.seq)).all()
    return ok(_cable_out(c, list(points)))


@router.put("/cables/{cable_id}/status", dependencies=[Depends(require_permission("cable:manage"))])
def update_cable_status(cable_id: int, req: StatusUpdate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    c = _cable_or_404(db, cable_id)
    if req.status not in (0, 1, 2):
        raise BizError(E_PARAM, "状态取值 0 停用 / 1 在用 / 2 归档")
    c.status = req.status
    c.updated_by = user.id
    db.commit()
    return ok(_cable_out(c))


@router.post("/cables/import", dependencies=[Depends(require_permission("cable:manage"))])
def import_cables(req: dict, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """导入 GeoJSON（FeatureCollection of LineString）：批量创建线缆（含路径节点与长度）。
    每条要素：properties.code/name/type/status/description；geometry LineString [lng,lat][]。
    """
    feats = req.get("features") if req.get("type") == "FeatureCollection" else (req.get("features") or [])
    if not isinstance(feats, list) or not feats:
        raise BizError(E_PARAM, "未识别的 GeoJSON（需 FeatureCollection）")
    created, skipped = 0, []
    for f in feats:
        geom = (f or {}).get("geometry") or {}
        props = (f or {}).get("properties") or {}
        if geom.get("type") != "LineString":
            skipped.append(props.get("code", "?") or "?（非 LineString）")
            continue
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            skipped.append(props.get("code", "?") or "?（节点不足）")
            continue
        code = str(props.get("code") or "").strip() or f"IMP-{uuid4().hex[:10]}"
        if db.scalar(select(Cable.id).where(Cable.code == code)):
            skipped.append(code + "（编码已存在）")
            continue
        c = Cable(
            code=code, name=str(props.get("name") or code)[:100],
            type=str(props.get("type") or "wire"), status=int(props.get("status") or 1),
            description=str(props.get("description") or "")[:500],
            created_by=user.id, updated_by=user.id,
        )
        db.add(c)
        db.flush()
        _rebuild_points(db, c, [(float(lat), float(lng)) for lng, lat in coords])
        created += 1
    db.commit()
    return ok({"created": created, "skipped": skipped})


# ============================ 标记点 ============================

@router.get("/cables/{cable_id}/markers", dependencies=[Depends(require_permission("cable:view"))])
def list_markers(cable_id: int, db: Session = Depends(get_db)) -> dict:
    _cable_or_404(db, cable_id)
    rows = db.scalars(select(CableMarker).where(CableMarker.cable_id == cable_id).order_by(CableMarker.cumulative_distance)).all()
    return ok([
        {"id": m.id, "lat": float(m.lat), "lng": float(m.lng),
         "cumulative_distance": float(m.cumulative_distance), "marker_type": m.marker_type,
         "label": m.label, "remark": m.remark}
        for m in rows
    ])


@router.post("/cables/{cable_id}/markers", dependencies=[Depends(require_permission("cable:manage"))])
def create_marker(cable_id: int, req: MarkerCreate, db: Session = Depends(get_db)) -> dict:
    c = _cable_or_404(db, cable_id)
    coords = [(float(p.lat), float(p.lng)) for p in db.scalars(select(CablePoint).where(CablePoint.cable_id == cable_id).order_by(CablePoint.seq)).all()]
    cum = 0.0
    if len(coords) >= 2:
        _, cum = geo_math.project_to_polyline(coords, (req.lat, req.lng))
    m = CableMarker(
        cable_id=cable_id, lat=req.lat, lng=req.lng, cumulative_distance=round(cum, 2),
        marker_type=req.marker_type, label=req.label, remark=req.remark,
    )
    db.add(m)
    db.commit()
    return ok({"id": m.id, "cumulative_distance": float(m.cumulative_distance)})


@router.delete("/cables/{cable_id}/markers/{marker_id}", dependencies=[Depends(require_permission("cable:manage"))])
def delete_marker(cable_id: int, marker_id: int, db: Session = Depends(get_db)) -> dict:
    m = db.get(CableMarker, marker_id)
    if m is None or m.cable_id != cable_id:
        raise BizError(E_NOT_FOUND, "标记点不存在")
    db.delete(m)
    db.commit()
    return ok()


# ============================ 故障 ============================

@router.get("/faults", dependencies=[Depends(require_permission("cable:view"))])
def list_faults(
    status: str = "",
    severity: str = "",
    near: str = "",
    exclude_closed: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    scope, _ids = _user_scope(db, user)
    stmt = select(CableFault).where(CableFault.deleted == 0)
    if exclude_closed:
        # 地图层使用：已关闭（status=5）故障不再显示
        stmt = stmt.where(CableFault.status != FAULT_CLOSED)
    if scope == "OWN":
        stmt = stmt.where(CableFault.reported_by == user.id)
    if status:
        stmt = stmt.where(CableFault.status == int(status))
    if severity:
        stmt = stmt.where(CableFault.severity == int(severity))
    rows = db.scalars(stmt.order_by(CableFault.id.desc())).all()
    if near:
        # 附近故障点：内存按球面距离过滤（数据量小；后续量大再加空间索引/范围查询）
        try:
            lat, lng, radius = [float(x) for x in near.split(",")]
        except ValueError:
            raise BizError(E_PARAM, "near 格式应为 lat,lng,radius_m") from None
        filtered = [f for f in rows if geo_math.haversine(lat, lng, float(f.lat), float(f.lng)) <= radius]
        filtered.sort(key=lambda f: geo_math.haversine(lat, lng, float(f.lat), float(f.lng)))
        page_rows = filtered[(page - 1) * page_size: page * page_size]
        linked = _linked_tasks_by_fault(db, [f.id for f in page_rows])
        return ok({"total": len(filtered), "page": page, "page_size": page_size,
                   "items": [_fault_out(f, linked.get(f.id)) for f in page_rows]})
    total = len(rows)
    paged = rows[(page - 1) * page_size: page * page_size]
    linked = _linked_tasks_by_fault(db, [f.id for f in paged])
    return ok({"total": total, "page": page, "page_size": page_size,
               "items": [_fault_out(f, linked.get(f.id)) for f in paged]})


@router.post("/faults", dependencies=[Depends(require_permission("fault:report"))])
def create_fault(req: FaultCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    cum = 0.0
    if req.cable_id:
        c = _cable_or_404(db, req.cable_id)
        coords = [(float(p.lat), float(p.lng)) for p in db.scalars(select(CablePoint).where(CablePoint.cable_id == c.id).order_by(CablePoint.seq)).all()]
        if len(coords) >= 2:
            _, cum = geo_math.project_to_polyline(coords, (req.lat, req.lng))
    f = CableFault(
        cable_id=req.cable_id, lat=req.lat, lng=req.lng, cumulative_distance=round(cum, 2),
        fault_type=req.fault_type, severity=req.severity, description=req.description,
        photos_note=req.photos_note, reported_by=user.id,
    )
    db.add(f)
    db.commit()
    return ok({"id": f.id})


@router.delete("/faults/{fault_id}", dependencies=[Depends(require_any_permission("fault:report", "fault:manage"))])
def delete_fault(fault_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """删除错误标点（软删除，deleted=1；数据保留可追溯）。

    权限：fault:manage（调度员/超管）可删任意；fault:report（维修人员）仅可删本人上报。
    已关联任务的历史仍可查（任务保留 fault_id）。"""
    f = db.get(CableFault, fault_id)
    if f is None or f.deleted:
        raise BizError(E_NOT_FOUND, "故障不存在")
    scope, _ = _user_scope(db, user)
    if scope != "ALL" and f.reported_by != user.id:
        raise BizError(4005, "仅可删除本人上报的故障", http_status=403)
    f.deleted = 1
    db.commit()
    return ok()


@router.put("/faults/{fault_id}", dependencies=[Depends(require_permission("fault:manage"))])
def update_fault(fault_id: int, req: FaultUpdate, db: Session = Depends(get_db)) -> dict:
    f = db.get(CableFault, fault_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "故障不存在")
    for k, v in req.model_dump(exclude_none=True).items():
        setattr(f, k, v)
    db.commit()
    return ok(_fault_out(f))


@router.put("/faults/{fault_id}/status", dependencies=[Depends(require_permission("fault:manage"))])
def update_fault_status(fault_id: int, req: FaultStatusUpdate, db: Session = Depends(get_db)) -> dict:
    f = db.get(CableFault, fault_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "故障不存在")
    if req.status not in FAULT_STATUS_LABELS:
        raise BizError(E_PARAM, "状态取值 0-5（待派发/已派发/进行中/完成待验/已验证/已关闭）")
    f.status = req.status
    db.commit()
    return ok(_fault_out(f))


@router.post("/faults/{fault_id}/photos", dependencies=[Depends(require_permission("fault:report"))])
def add_fault_photo(fault_id: int, req: FaultPhotoIn, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    f = db.get(CableFault, fault_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "故障不存在")
    row = FaultFile(fault_id=fault_id, file_id=req.file_id, category=req.category, remark=req.remark, created_by=user.id)
    db.add(row)
    db.commit()
    return ok({"id": row.id})


@router.get("/faults/{fault_id}/photos", dependencies=[Depends(require_permission("fault:report"))])
def list_fault_photos(fault_id: int, db: Session = Depends(get_db)) -> dict:
    """故障照片列表（fault_file → sys_file，前端按 file_id 拼文件预览 URL）。"""
    from app.models import SysFile

    rows = db.scalars(select(FaultFile).where(FaultFile.fault_id == fault_id).order_by(FaultFile.sort_order, FaultFile.id)).all()
    file_ids = [r.file_id for r in rows]
    files = {f.id: f for f in db.scalars(select(SysFile).where(SysFile.id.in_(file_ids))).all()} if file_ids else {}
    return ok([
        {
            "id": r.id,
            "file_id": r.file_id,
            "category": r.category,
            "remark": r.remark,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "url": f"/files/{r.file_id}" if r.file_id in files else "",
        }
        for r in rows
    ])


# ============================ 测距 / 导航 ============================

@router.post("/geo/measure", dependencies=[Depends(require_permission("cable:view"))])
def geo_measure(req: MeasureReq, db: Session = Depends(get_db)) -> dict:
    """测距定位：按目标累计距离插值出线上点。"""
    c = _cable_or_404(db, req.cable_id)
    coords = [(float(p.lat), float(p.lng)) for p in db.scalars(select(CablePoint).where(CablePoint.cable_id == c.id).order_by(CablePoint.seq)).all()]
    if len(coords) < 2:
        raise BizError(E_PARAM, "线缆至少需要 2 个路径节点")
    dists = geo_math.cumulative_distances(coords)
    if req.distance < 0 or req.distance > dists[-1]:
        raise BizError(E_PARAM, f"距离超出线缆范围（0 ~ {round(dists[-1], 2)} 米）")
    lat, lng = geo_math.interpolate_by_distance(coords, dists, req.distance)
    # 最近标记点
    nearest = None
    markers = db.scalars(select(CableMarker).where(CableMarker.cable_id == c.id)).all()
    if markers:
        best = min(
            markers,
            key=lambda m: geo_math.haversine(lat, lng, float(m.lat), float(m.lng)),
        )
        nearest = {
            "label": best.label or best.marker_type,
            "distance": round(geo_math.haversine(lat, lng, float(best.lat), float(best.lng)), 1),
        }
    return ok({
        "lat": round(lat, 7), "lng": round(lng, 7),
        "cumulative_distance": round(req.distance, 2),
        "total_length": float(c.total_length),
        "nearest_marker": nearest,
    })


@router.post("/geo/navigate", dependencies=[Depends(require_permission("cable:view"))])
def geo_navigate(req: NavigateReq, db: Session = Depends(get_db)) -> dict:
    """故障导航：返回用户到目标故障沿线的投影、剩余距离与候选线缆。"""
    fault = db.get(CableFault, req.fault_id)
    if fault is None or fault.deleted:
        raise BizError(E_NOT_FOUND, "故障不存在")
    user_pt = (req.lat, req.lng)
    fault_pt = (float(fault.lat), float(fault.lng))
    straight = geo_math.haversine(user_pt[0], user_pt[1], fault_pt[0], fault_pt[1])

    cables = db.scalars(select(Cable).where(Cable.status == 1)).all()
    candidates = []
    chosen: Cable | None = None
    proj = None
    fault_cum = float(fault.cumulative_distance or 0)
    for c in cables:
        coords = [(float(p.lat), float(p.lng)) for p in db.scalars(select(CablePoint).where(CablePoint.cable_id == c.id).order_by(CablePoint.seq)).all()]
        if len(coords) < 2:
            continue
        (pl, pn), cum = geo_math.project_to_polyline(coords, user_pt)
        _, fault_cum_c = geo_math.project_to_polyline(coords, fault_pt)
        dist = geo_math.haversine(pl, pn, user_pt[0], user_pt[1])
        heading_diff = None
        if req.heading is not None and dist > 5:
            # 用用户航向与「到投影点方向」夹角过滤平行线缆（用户已在线上时航向无意义，不过滤）
            hb = geo_math.bearing(user_pt, (pl, pn))
            heading_diff = round(geo_math.heading_diff(req.heading, hb), 1)
            if heading_diff > 60:
                continue
        candidates.append({
            "cable_id": c.id, "cable_name": c.name,
            "projection": {"lat": round(pl, 7), "lng": round(pn, 7), "cumulative_distance": round(cum, 2)},
            "fault_cumulative": round(fault_cum_c, 2),
            "distance_to_user": round(dist, 1),
            "heading_diff": heading_diff,
        })
    if candidates:
        candidates.sort(key=lambda x: x["distance_to_user"])
        chosen = candidates[0]
        proj = chosen["projection"]
        fault_cum = chosen["fault_cumulative"]
        c = db.get(Cable, chosen["cable_id"])
        coords = [(float(p.lat), float(p.lng)) for p in db.scalars(select(CablePoint).where(CablePoint.cable_id == c.id).order_by(CablePoint.seq)).all()]
        # 路径：投影点 → 故障点（沿线方向）
        dists = geo_math.cumulative_distances(coords)
        step = max(1.0, dists[-1] / 200)
        cum_from, cum_to = min(proj["cumulative_distance"], fault_cum), max(proj["cumulative_distance"], fault_cum)
        path = []
        cur = cum_from
        while cur <= cum_to:
            la, ln = geo_math.interpolate_by_distance(coords, dists, cur)
            path.append([round(la, 7), round(ln, 7)])
            cur += step
        path.append([float(fault.lat), float(fault.lng)])
        recommended = True
    else:
        c = db.get(Cable, fault.cable_id) if fault.cable_id else None
        coords = []
        if c:
            coords = [(float(p.lat), float(p.lng)) for p in db.scalars(select(CablePoint).where(CablePoint.cable_id == c.id).order_by(CablePoint.seq)).all()]
        if coords and fault_cum == 0:
            _, fault_cum = geo_math.project_to_polyline(coords, fault_pt)
        path = [[float(fault.lat), float(fault.lng)], [req.lat, req.lng]]
        recommended = False
    remaining = geo_math.remaining_distance(proj["cumulative_distance"] if proj else 0.0, fault_cum) if proj else straight
    return ok({
        "straight_distance": round(straight, 1),
        "projection": proj,
        "fault_cumulative": round(fault_cum, 2),
        "remaining_distance": round(remaining, 1),
        "path": path,
        "candidates": candidates,
        "recommended": recommended,
    })


@router.get("/geo/nearby-faults", dependencies=[Depends(require_permission("cable:view"))])
def nearby_faults(lat: float = Query(...), lng: float = Query(...), radius: float = Query(500, gt=0, le=50000), db: Session = Depends(get_db)) -> dict:
    all_rows = db.scalars(select(CableFault).where(CableFault.deleted == 0, CableFault.status.in_(FAULT_ACTIVE_STATUSES))).all()
    items = []
    for f in all_rows:
        d = geo_math.haversine(lat, lng, float(f.lat), float(f.lng))
        if d <= radius:
            out = _fault_out(f)
            out["distance"] = round(d, 1)
            items.append(out)
    items.sort(key=lambda x: x["distance"])
    return ok({"items": items[:50]})
