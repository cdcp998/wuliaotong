"""存储位置管理（多存储地址）：CRUD + 空间检测（《后端API设计.md》§7，权限 sys:config）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.sys import SysFile, SysStorage
from app.schemas.storage import StorageOut, StorageReq
from app.services.storage import storage_health

router = APIRouter(tags=["存储管理"], dependencies=[Depends(get_current_user)])


def _out(db: Session, s: SysStorage) -> dict:
    cnt = db.scalar(select(func.count()).select_from(SysFile).where(SysFile.storage_id == s.id)) or 0
    return StorageOut(
        id=s.id, name=s.name, type=s.type, path=s.path, policy=s.policy,
        is_default=s.is_default, status=s.status, remark=s.remark, file_count=cnt,
    ).model_dump()


@router.get("/storages", dependencies=[Depends(require_permission("sys:config"))])
def list_storages(db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(SysStorage).order_by(SysStorage.id)).all()
    return ok([_out(db, s) for s in rows])


@router.post("/storages", dependencies=[Depends(require_permission("sys:config"))])
def create_storage(req: StorageReq, db: Session = Depends(get_db)) -> dict:
    dup = db.scalar(select(SysStorage.id).where(SysStorage.name == req.name))
    if dup:
        raise BizError(E_PARAM, "存储位置名称已存在")
    s = SysStorage(**req.model_dump())
    if req.is_default:
        # 同一时间仅一个默认存储
        for other in db.scalars(select(SysStorage).where(SysStorage.is_default == 1)).all():
            other.is_default = 0
    db.add(s)
    db.commit()
    db.refresh(s)
    return ok(_out(db, s))


@router.put("/storages/{storage_id}", dependencies=[Depends(require_permission("sys:config"))])
def update_storage(storage_id: int, req: StorageReq, db: Session = Depends(get_db)) -> dict:
    s = db.get(SysStorage, storage_id)
    if s is None:
        raise BizError(E_NOT_FOUND, "存储位置不存在")
    dup = db.scalar(select(SysStorage.id).where(SysStorage.name == req.name, SysStorage.id != storage_id))
    if dup:
        raise BizError(E_PARAM, "存储位置名称已存在")
    for k, v in req.model_dump().items():
        setattr(s, k, v)
    if req.is_default:
        for other in db.scalars(select(SysStorage).where(SysStorage.is_default == 1, SysStorage.id != storage_id)).all():
            other.is_default = 0
    db.commit()
    return ok()


@router.delete("/storages/{storage_id}", dependencies=[Depends(require_permission("sys:config"))])
def delete_storage(storage_id: int, db: Session = Depends(get_db)) -> dict:
    s = db.get(SysStorage, storage_id)
    if s is None:
        raise BizError(E_NOT_FOUND, "存储位置不存在")
    cnt = db.scalar(select(func.count()).select_from(SysFile).where(SysFile.storage_id == storage_id)) or 0
    if cnt:
        raise BizError(E_PARAM, f"该存储已有 {cnt} 个文件，禁止删除（可停用）")
    db.delete(s)
    db.commit()
    return ok()


@router.get("/storages/health", dependencies=[Depends(require_permission("sys:config"))])
def storages_health(db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(SysStorage).order_by(SysStorage.id)).all()
    return ok([storage_health(s) for s in rows])
