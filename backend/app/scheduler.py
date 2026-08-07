"""定时任务（APScheduler）：库存预警扫描（《数据库设计.md》决策7、API 设计 §9）。

每分钟扫描 stk_stock 与商品上下限，生成站内通知（接收人：超管/管理者/仓管员）。
幂等：同一商品同一类型预警在最近 1 小时内存在未读通知则不重复生成。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

from app.db import SessionLocal
from app.core.cache import cache_delete_pattern
from app.models.base import BaseProduct
from app.models.stock import StkStock
from app.models.sys import SysNotification, SysRole, SysUser
from app.services.backup import cleanup_auto_backups, run_backup
from app.services.ai.alert_text import generate_alert_text
from app.services.quota import check_quota_warnings

logger = logging.getLogger(__name__)

ALERT_RECEIVER_ROLES = ("super_admin", "manager", "storekeeper")


def scan_stock_alerts() -> dict:
    """扫描并生成库存预警通知，返回生成条数。"""
    db = SessionLocal()
    try:
        role_ids = db.scalars(
            select(SysRole.id).where(SysRole.code.in_(ALERT_RECEIVER_ROLES))
        ).all()
        receivers = db.scalars(
            select(SysUser.id).where(SysUser.role_id.in_(role_ids), SysUser.status == 1)
        ).all()
        if not receivers:
            return {"alerts": 0}

        cutoff = datetime.now() - timedelta(hours=1)
        created = 0
        rows = db.execute(
            select(StkStock, BaseProduct)
            .join(BaseProduct, BaseProduct.id == StkStock.product_id)
            .where(StkStock.qty != 0)
        ).all()
        for stock, product in rows:
            alerts: list[tuple[str, str]] = []
            if product.min_stock and stock.qty < product.min_stock:
                alerts.append(("低库存", generate_alert_text(db, product=product, qty=stock.qty, kind="低库存")))
            if product.max_stock and stock.qty > product.max_stock:
                alerts.append(("高库存", generate_alert_text(db, product=product, qty=stock.qty, kind="高库存")))

            for title, content in alerts:
                dup = db.scalar(
                    select(SysNotification.id)
                    .where(
                        SysNotification.biz_type == "预警",
                        SysNotification.title == title,
                        SysNotification.content.like(f"%({product.code})%"),
                        SysNotification.created_at >= cutoff,
                        SysNotification.is_read == 0,
                    )
                    .limit(1)
                )
                if dup:
                    continue
                for uid in receivers:
                    db.add(SysNotification(user_id=uid, title=title, content=content, biz_type="预警"))
                created += 1
        db.commit()
        if created:
            cache_delete_pattern("notify:unread:*")  # 新预警通知 → 未读数缓存失效
        return {"alerts": created}
    finally:
        db.close()


scheduler = BackgroundScheduler(timezone="Asia/Shanghai")


def run_daily_backup() -> dict:
    """每日凌晨自动备份（sys_backup_log backup_type=auto），保留最近 AUTO_KEEP 份。"""
    db = SessionLocal()
    try:
        run_backup(db, "auto")
        removed = cleanup_auto_backups(db)
        logger.info("daily backup done, cleaned=%d", removed)
        return {"backup": 1, "cleaned": removed}
    except Exception as exc:  # 备份失败不影响主流程，记录一条失败日志
        logger.error("daily backup failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return {"backup": 0, "error": str(exc)}
    finally:
        db.close()


def start_scheduler() -> None:
    """应用启动时调用（lifespan）。"""
    if not scheduler.running:
        scheduler.add_job(
            scan_stock_alerts,
            "interval",
            minutes=1,
            id="stock_alerts",
            replace_existing=True,
            next_run_time=datetime.now(),
        )
        scheduler.add_job(
            run_daily_backup,
            "cron",
            hour=2,
            minute=0,
            id="daily_backup",
            replace_existing=True,
        )
        scheduler.add_job(
            check_quota_warnings,
            "interval",
            minutes=5,  # 轻量触发；是否执行配额获取/预警由内部按配置间隔（默认 1 小时）判断
            id="quota_warnings",
            replace_existing=True,
            next_run_time=datetime.now(),
        )
        scheduler.start()
        logger.info("scheduler started: stock_alerts(1min), daily_backup(02:00), quota_refresh+check(5min trigger)")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("scheduler stopped")
