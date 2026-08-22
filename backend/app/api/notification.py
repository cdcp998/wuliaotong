"""站内通知接口（《后端API设计.md》§9 + 线缆和设备插件方案 §5.9/§6.6）：
本人通知列表/已读/未读数/删除；通知渠道配置（sys:config）；投递记录查询（管理者及以上）。"""
from __future__ import annotations

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.cache import cache_aside, cache_delete_pattern
from app.core.deps import get_current_user, require_manager_role, require_permission
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models.sys import SysNotification, SysNotificationDelivery, SysUser
from app.services.notify import get_channels_config, save_channels_config

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


# ============================ 通知渠道配置 / 投递记录（插件方案 §6.6） ============================

class ChannelsReq(BaseModel):
    channels: list[str] = Field(..., min_length=1, max_length=3)
    # 短信服务商配置（可选；对应 sys_config sms.*）
    sms_provider: str = ""


@router.get("/notifications/channels", dependencies=[Depends(require_permission("sys:config"))])
def get_channels(db: Session = Depends(get_db)) -> dict:
    """通知渠道配置（站内/邮件/短信）。"""
    cfg = get_channels_config(db)
    return ok({
        "channels": cfg.get("channels", ["internal"]),
        "sms_provider": _sms_provider(db),
        "sms_configured": bool(_sms_provider(db)),
    })


@router.put("/notifications/channels", dependencies=[Depends(require_permission("sys:config"))])
def put_channels(req: ChannelsReq, db: Session = Depends(get_db)) -> dict:
    for c in req.channels:
        if c not in ("internal", "email", "sms"):
            raise BizError(E_PARAM, f"未知渠道：{c}")
    cfg = save_channels_config(db, {"channels": req.channels})
    if req.sms_provider:
        _set_sys_cfg(db, "sms.provider", req.sms_provider)
    return ok({"channels": cfg.get("channels", [])})


def _sms_provider(db: Session) -> str:
    from app.models import SysConfig

    row = db.scalar(select(SysConfig).where(SysConfig.config_key == "sms.provider"))
    return row.config_value if row and row.config_value else ""


def _set_sys_cfg(db: Session, key: str, value: str) -> None:
    from app.models import SysConfig

    row = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    if row:
        row.config_value = value
    else:
        db.add(SysConfig(config_key=key, config_value=value, remark="短信配置"))
    db.commit()


@router.get("/notifications/deliveries", dependencies=[Depends(require_manager_role())])
def list_deliveries(
    channel: str = "",
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    """通知投递记录查询（审计对账）：渠道/状态筛选。"""
    stmt = select(SysNotificationDelivery)
    if channel:
        stmt = stmt.where(SysNotificationDelivery.channel == channel)
    if status:
        stmt = stmt.where(SysNotificationDelivery.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(SysNotificationDelivery.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({
        "total": total, "page": page, "page_size": page_size,
        "items": [{
            "id": d.id, "notification_id": d.notification_id, "biz_type": d.biz_type, "biz_id": d.biz_id,
            "channel": d.channel, "recipient": d.recipient, "status": d.status, "provider": d.provider,
            "provider_message_id": d.provider_message_id, "retry_count": d.retry_count,
            "last_error": d.last_error, "sent_at": d.sent_at.isoformat() if d.sent_at else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        } for d in rows],
    })
