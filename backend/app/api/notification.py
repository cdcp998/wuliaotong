"""站内通知接口（《后端API设计.md》§9）：本人通知列表/已读/未读数/删除。"""
from __future__ import annotations

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.cache import cache_aside, cache_delete_pattern
from app.core.deps import get_current_user
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.sys import SysNotification, SysUser

router = APIRouter(tags=["通知"], dependencies=[Depends(get_current_user)])


class NotificationDeleteReq(BaseModel):
    """批量删除通知（仅本人，单次上限 200）。"""
    ids: list[int] = Field(..., min_length=1, max_length=200)


def _out(n: SysNotification) -> dict:
    return {"id": n.id, "title": n.title, "content": n.content, "biz_type": n.biz_type, "link": n.link, "is_read": n.is_read, "created_at": n.created_at}


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
    # 前端轮询热点：30 秒 TTL；读通知/新通知生成时即时失效
    cnt = cache_aside(f"notify:unread:{user.id}", 30, lambda: (
        db.scalar(
            select(func.count()).select_from(SysNotification).where(
                SysNotification.user_id == user.id, SysNotification.is_read == 0
            )
        ) or 0
    ))
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
    cache_delete_pattern(f"notify:unread:{user.id}")
    return ok()


@router.put("/notifications/read-all")
def mark_read_all(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    db.execute(
        SysNotification.__table__.update()
        .where(SysNotification.user_id == user.id, SysNotification.is_read == 0)
        .values(is_read=1)
    )
    db.commit()
    cache_delete_pattern(f"notify:unread:{user.id}")
    return ok()


@router.delete("/notifications/{notify_id}")
def delete_notification(notify_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """删除单条通知（仅本人）。"""
    n = db.get(SysNotification, notify_id)
    if n is None or n.user_id != user.id:
        raise BizError(E_NOT_FOUND, "通知不存在")
    db.delete(n)
    db.commit()
    cache_delete_pattern(f"notify:unread:{user.id}")
    return ok()


@router.post("/notifications/delete")
def delete_notifications(req: NotificationDeleteReq, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """批量删除通知（仅本人；重复/不属于本人的 id 自动忽略）。"""
    result = db.execute(
        delete(SysNotification).where(
            SysNotification.id.in_(req.ids),
            SysNotification.user_id == user.id,
        )
    )
    db.commit()
    cache_delete_pattern(f"notify:unread:{user.id}")
    return ok({"deleted": result.rowcount or 0})


@router.delete("/notifications")
def delete_all_notifications(user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """清空本人全部通知。"""
    result = db.execute(delete(SysNotification).where(SysNotification.user_id == user.id))
    db.commit()
    cache_delete_pattern(f"notify:unread:{user.id}")
    return ok({"deleted": result.rowcount or 0})
