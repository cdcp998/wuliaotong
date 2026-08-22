"""通知分发核心（线缆和设备插件方案 §5.9 / §13.7）：notify_user 统一入口。

- 站内通知总是创建（internal 为基础触达）；按 channels 生成 sys_notification_delivery 投递记录。
- 实际发送由 app/services/notify/worker.py（随核心启动，独立于任何模块）异步处理，
  单条失败仅标 failed + retry_count + 重试 ≤3，异常隔离；模块停用不影响通知投递。
- 幂等：idempotency_key 唯一键（uk_idempotency）防重复发送。
- 渠道配置：sys_config notify.channels（JSON：{"channels": ["internal","email","sms"]}）。
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SysConfig, SysNotification, SysNotificationDelivery, SysUser

logger = logging.getLogger("app.notify.core")

DEFAULT_CHANNELS = ["internal"]
MAX_RETRY = 3
CONFIG_KEY = "notify.channels"

_CHANNEL_RECIPIENT = {
    "internal": lambda u: str(u.id),
    "email": lambda u: u.email,
    "sms": lambda u: u.phone,
}


def get_channels_config(db: Session) -> dict:
    """读取通知渠道配置（缺省仅站内）。"""
    row = db.scalar(select(SysConfig).where(SysConfig.config_key == CONFIG_KEY))
    if row and row.config_value:
        try:
            cfg = json.loads(row.config_value)
            if isinstance(cfg, dict) and isinstance(cfg.get("channels"), list):
                return cfg
        except (TypeError, ValueError):
            pass
    return {"channels": list(DEFAULT_CHANNELS)}


def save_channels_config(db: Session, config: dict) -> dict:
    row = db.scalar(select(SysConfig).where(SysConfig.config_key == CONFIG_KEY))
    value = json.dumps(config, ensure_ascii=False)
    if row:
        row.config_value = value
    else:
        db.add(SysConfig(config_key=CONFIG_KEY, config_value=value, remark="通知投递渠道（internal/email/sms）"))
    db.commit()
    return config


def notify_user(
    db: Session,
    user_id: int,
    title: str,
    content: str,
    biz_type: str = "",
    link: str = "",
    channels: list[str] | None = None,
    idempotency_key: str = "",
    biz_id: int = 0,
) -> SysNotification:
    """创建站内通知 + 各渠道投递记录（pending），返回通知对象。

    channels 为空 → 取系统通知渠道配置；idempotency_key 命中 → 直接返回已有通知（防重复）。
    """
    user = db.get(SysUser, user_id)
    if user is None:
        raise ValueError(f"通知接收人不存在：{user_id}")
    chans = channels or get_channels_config(db).get("channels") or DEFAULT_CHANNELS
    chans = [c for c in chans if c in ("internal", "email", "sms")] or ["internal"]

    if idempotency_key:
        # 存储键为 f"{key}:{channel}"（uk 唯一），按前缀匹配任一渠道记录即视为已发送
        existing = db.scalar(
            select(SysNotificationDelivery)
            .where(SysNotificationDelivery.idempotency_key.like(f"{idempotency_key}:%"))
            .order_by(SysNotificationDelivery.id)
            .limit(1)
        )
        if existing is not None:
            existing_notif = db.get(SysNotification, existing.notification_id) if existing.notification_id else None
            if existing_notif is not None:
                return existing_notif

    notif = SysNotification(
        user_id=user_id, title=title, content=content, biz_type=biz_type,
        link=link, channels=",".join(chans),
    )
    db.add(notif)
    db.flush()
    for ch in chans:
        # 幂等键按渠道细分（uk_idempotency 唯一）：显式 key → f"{key}:{ch}"；未提供 → 随机（不做跨请求去重）
        ch_key = f"{idempotency_key}:{ch}" if idempotency_key else f"auto-{__import__('uuid').uuid4().hex}"
        recipient = _CHANNEL_RECIPIENT[ch](user)
        if not recipient:
            db.add(SysNotificationDelivery(
                notification_id=notif.id, biz_type=biz_type, biz_id=biz_id, channel=ch,
                recipient="", status="failed", last_error=f"用户未配置{'邮箱' if ch == 'email' else '手机号'}",
                idempotency_key=ch_key,
            ))
            continue
        db.add(SysNotificationDelivery(
            notification_id=notif.id, biz_type=biz_type, biz_id=biz_id, channel=ch,
            recipient=recipient, status="pending", idempotency_key=ch_key,
        ))
    db.flush()
    return notif
