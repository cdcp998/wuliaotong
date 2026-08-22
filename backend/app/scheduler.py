"""定时任务（APScheduler）：库存预警扫描（《数据库设计.md》决策7、API 设计 §9）。

每分钟扫描 stk_stock 与商品上下限，生成站内通知（接收人：超管/管理者/仓管员）。
幂等：同一商品同一类型预警在最近 1 小时内已通知过则不重复生成（与已读状态无关——
避免用户点「全部已读」后同一持续预警被每分钟重新刷屏）。"""
from __future__ import annotations

import logging
from collections.abc import Callable
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
from app.services.notify.worker import notify_worker_tick
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
        # 只扫描命中预警条件的行（低库存/高库存），避免每分钟全表拉取后逐行判断
        from sqlalchemy import and_, or_

        rows = db.execute(
            select(StkStock, BaseProduct)
            .join(BaseProduct, BaseProduct.id == StkStock.product_id)
            .where(
                StkStock.qty != 0,
                or_(
                    and_(BaseProduct.min_stock > 0, StkStock.qty < BaseProduct.min_stock),
                    and_(BaseProduct.max_stock > 0, StkStock.qty > BaseProduct.max_stock),
                ),
            )
        ).all()
        # 一次拉取近期预警，内存按标题+内容判断去重（替代每个商品一次 LIKE 查询）；
        # 只看时间窗口、不看已读状态：标记已读不应让同一持续预警在窗口内重新生成
        recent = db.execute(
            select(SysNotification.title, SysNotification.content)
            .where(
                SysNotification.biz_type == "预警",
                SysNotification.created_at >= cutoff,
            )
        ).all()
        existing: dict[str, list[str]] = {}
        for title, content in recent:
            existing.setdefault(title, []).append(content)
        for stock, product in rows:
            alerts: list[tuple[str, str]] = []
            if product.min_stock and stock.qty < product.min_stock:
                alerts.append(("低库存", generate_alert_text(db, product=product, qty=stock.qty, kind="低库存")))
            if product.max_stock and stock.qty > product.max_stock:
                alerts.append(("高库存", generate_alert_text(db, product=product, qty=stock.qty, kind="高库存")))

            for title, content in alerts:
                # 正文中商品编码出现在全角/半角括号内均视为已预警（与 generate_alert_text 输出一致）
                if any(f"（{product.code}）" in c or f"({product.code})" in c for c in existing.get(title, [])):
                    continue
                for uid in receivers:
                    db.add(SysNotification(user_id=uid, title=title, content=content, biz_type="预警", link="/stock/query"))
                created += 1
                existing.setdefault(title, []).append(content)
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
        scheduler.add_job(
            notify_worker_tick,
            "interval",
            seconds=30,
            id="notify_worker",
            replace_existing=True,
            next_run_time=datetime.now(),
        )
        _register_module_jobs()
        scheduler.start()
        logger.info("scheduler started: stock_alerts(1min), daily_backup(02:00), quota_warnings(5min), notify_worker(30s)")


def _register_module_jobs() -> None:
    """注册模块提供的定时任务（线缆和设备插件方案 §2.2/§13.1.5）。

    模块约定：ModuleDef.jobs 中每个 Callable 可带属性 interval_minutes（分钟，缺省 1）；
    每次触发先检查模块 ENABLED，未启用直接跳过（tick 检查 ENABLED）。
    """
    from app.core.modules import get_module_defs, module_enabled

    for d in get_module_defs().values():
        for job in d.jobs:
            minutes = getattr(job, "interval_minutes", 1) or 1
            code = d.code

            def _runner(job_fn: Callable = job, mod_code: str = code) -> None:
                db = SessionLocal()
                try:
                    if module_enabled(db, mod_code):
                        job_fn()
                    else:
                        logger.debug("模块 %s 未启用，跳过定时任务 %s", mod_code, job_fn.__name__)
                except Exception:  # noqa: BLE001 模块任务异常隔离，只记日志
                    logger.exception("模块定时任务 %s/%s 执行失败", mod_code, job_fn.__name__)
                finally:
                    db.close()

            scheduler.add_job(
                _runner,
                "interval",
                minutes=minutes,
                id=f"mod:{code}:{job.__name__}",
                replace_existing=True,
                next_run_time=datetime.now(),
            )
            logger.info("scheduler registered module job: mod:%s:%s (%dmin)", code, job.__name__, minutes)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("scheduler stopped")
