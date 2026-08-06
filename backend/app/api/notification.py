"""站内通知接口（《后端API设计.md》§9）：本人通知列表/已读/未读数。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.response import BizError, E_NOT_FOUND, ok
from app.db import get_db
from app.models.sys import SysNotification, SysUser

router = APIRouter(tags=["通知"], dependencies=[Depends(get_current_user)])


def _out(n: SysNotification) -> dict:
    return {"id": n.id, "title": n.title, "content": n.content, "biz_type": n.biz_type, "is_read": n.is_read, "created_at": n.created_at}


@router.get("/notifications")
def list_notifications(
    is_read: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(SysNotification).where(SysNotification.user_id == user.id)
    if is_read is not None:
        stmt = stmt.where(SysNotification.is_read == is_read)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(SysNotification.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({"list": [_out(n) for n in rows], "total": total, "page": page, "page_size": page_size})


@router.get("/notifications/unread-count")
def unread_count(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    cnt = db.scalar(
        select(func.count()).select_from(SysNotification).where(
            SysNotification.user_id == user.id, SysNotification.is_read == 0
        )
    ) or 0
    return ok({"unread_count": cnt})


@router.put("/notifications/{notify_id}/read")
def mark_read(
    notify_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    n = db.get(SysNotification, notify_id)
    if n is None or n.user_id != user.id:
        raise BizError(E_NOT_FOUND, "通知不存在")
    n.is_read = 1
    db.commit()
    return ok()


@router.put("/notifications/read-all")
def mark_read_all(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    db.execute(
        SysNotification.__table__.update()
        .where(SysNotification.user_id == user.id, SysNotification.is_read == 0)
        .values(is_read=1)
    )
    db.commit()
    return ok()
