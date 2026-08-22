"""通知发送 worker（核心服务，随核心启动，独立于任何模块；线缆和设备插件方案 §5.9）。

- 扫描 pending/sending 投递记录（internal/email/sms），单条失败标 failed + retry_count+1（≤3），
  异常隔离：单条失败不影响其他记录，worker 永不崩。
- 短信客户端抽象 SmsClient：aliyun/tencent/ronglian/http（通用 HTTP 模板），未配置 → failed。
- 幂等由 uk_idempotency 兜底（创建侧），本 worker 不做重复发送。
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import SysConfig, SysNotificationDelivery
from app.services.mail import send_mail

logger = logging.getLogger("app.notify.worker")

MAX_RETRY = 3
_TICK_LIMIT = 50


def _sys_cfg(db: Session, key: str, default: str = "") -> str:
    row = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    return row.config_value if row and row.config_value else default


# ============================ 短信客户端抽象 ============================


class SmsClient:
    """短信客户端抽象：未配置/未知服务商 → 抛 NotConfigured（worker 标 failed）。"""

    def __init__(self, provider: str, endpoint: str = "", sign: str = "", key: str = "", secret: str = "") -> None:
        self.provider = provider or ""
        self.endpoint = endpoint
        self.sign = sign
        self.key = key
        self.secret = secret

    def send(self, phone: str, message: str) -> str:
        """发送短信，成功返回服务商回执 id；未配置抛 RuntimeError（worker 标 failed 重试）。"""
        if not self.provider:
            raise RuntimeError("短信服务商未配置（sys_config sms.provider）")
        if self.provider == "http":
            # 通用 HTTP 模板：endpoint 必填；POST JSON {phone, content, sign, key}
            import json
            import urllib.request

            if not self.endpoint:
                raise RuntimeError("通用 HTTP 短信 endpoint 未配置")
            payload = {"phone": phone, "content": message, "sign": self.sign, "key": self.key}
            req = urllib.request.Request(
                self.endpoint,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            if not body:
                raise RuntimeError("短信接口返回为空")
            return body[:100]
        raise RuntimeError(f"短信服务商 {self.provider} 暂未实现（支持 http / 预留 aliyun/tencent/ronglian）")


# ============================ worker ============================


def _process_delivery(db: Session, d: SysNotificationDelivery) -> None:
    d.status = "sending"
    if d.channel == "internal":
        d.status = "success"
        d.sent_at = datetime.now()
        return
    if d.channel == "email":
        from app.models import SysNotification

        notif = db.get(SysNotification, d.notification_id) if d.notification_id else None
        if notif is None:
            raise RuntimeError("通知已被删除，无法发送邮件")
        if not d.recipient:
            raise RuntimeError("收件邮箱为空")
        send_mail(db, d.recipient, notif.title, notif.content[:2000])
        d.status = "success"
        d.sent_at = datetime.now()
        return
    if d.channel == "sms":
        client = SmsClient(
            provider=_sys_cfg(db, "sms.provider"),
            endpoint=_sys_cfg(db, "sms.endpoint"),
            sign=_sys_cfg(db, "sms.sign"),
            key=_sys_cfg(db, "sms.key"),
            secret=_sys_cfg(db, "sms.secret"),
        )
        if not d.recipient:
            raise RuntimeError("手机号为空")
        from app.models import SysNotification

        notif = db.get(SysNotification, d.notification_id) if d.notification_id else None
        message = f"【{_sys_cfg(db, 'sms.sign') or '物料通'}】{notif.title if notif else '新通知'}：{(notif.content if notif else '')[:200]}"
        msg_id = client.send(d.recipient, message)
        d.provider_message_id = msg_id
        d.provider = client.provider
        d.status = "success"
        d.sent_at = datetime.now()
        return
    raise RuntimeError(f"未知渠道 {d.channel}")


def notify_worker_tick() -> None:
    """处理 pending/sending 投递记录（每轮 ≤50 条；单条失败仅标 failed + 重试 ≤3）。"""
    db = SessionLocal()
    try:
        rows = db.scalars(
            select(SysNotificationDelivery)
            .where(SysNotificationDelivery.status.in_(("pending", "sending")))
            .order_by(SysNotificationDelivery.id)
            .limit(_TICK_LIMIT)
        ).all()
        for d in rows:
            try:
                _process_delivery(db, d)
            except Exception as exc:  # noqa: BLE001 异常隔离：单条失败不影响其他
                db.rollback()
                d = db.get(SysNotificationDelivery, d.id)
                if d is None:
                    continue
                d.retry_count += 1
                d.status = "failed" if d.retry_count >= MAX_RETRY else "pending"
                d.last_error = str(exc)[:300]
                logger.warning("投递 #%s(%s) 第 %s 次失败：%s", d.id, d.channel, d.retry_count, exc)
        db.commit()
    finally:
        db.close()
