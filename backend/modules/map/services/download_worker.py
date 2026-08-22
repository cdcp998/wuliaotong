"""map 模块：瓦片批量下载 worker（方案 §5.4/§9.2）。

- 消费 map_download_task（status=0 待下载），经 tile_cache 抓取落盘（容量/每日配额保护）。
- 失败重试 ≤2；区域（非暂停）无待下载任务后置「完成」并更新统计。
- 与瓦片清理接口共用 tile_cache.py 统一入口（进程锁，v2.1 ⑭）。
- 源：优先任务记录的 source；无记录/未配置回退当前首个启用源。
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import func, select

from app.db import SessionLocal
from app.modules.map.models import MapCacheRegion, MapDownloadTask
from app.modules.map.services import config_store, tile_cache

logger = logging.getLogger("app.map.download")

_TICK_LIMIT = 20
_MAX_RETRY = 2


def download_worker_tick() -> None:
    """批量下载一轮（每轮 ≤20 个任务；异常隔离：单任务失败仅标失败/重试）。

    源：优先任务记录的 source（migration 0001）；无记录/未配置回退当前首个启用源。
    """
    db = SessionLocal()
    try:
        config = config_store.effective_config(db)
        sources = config.get("map_sources") or {}
        default_key = next((k for k, s in sources.items() if s.get("enabled")), None)
        if default_key is None:
            return
        rows = db.execute(
            select(MapDownloadTask, MapCacheRegion)
            .join(MapCacheRegion, MapCacheRegion.id == MapDownloadTask.region_id)
            .where(MapDownloadTask.status == 0, MapCacheRegion.status != 3)
            .order_by(MapDownloadTask.id)
            .limit(_TICK_LIMIT)
        ).all()
        affected: set[int] = set()
        for task, region in rows:
            affected.add(region.id)
            source_key = (task.source or "") if (task.source or "") in sources else default_key
            src = sources.get(source_key)
            if src is None:
                task.status = 2
                task.retry_count += 1
                continue
            try:
                data = tile_cache.get_tile(src, source_key, task.z, task.x, task.y)
                if not data:
                    raise ValueError("瓦片数据为空")
                task.status = 1
            except Exception as exc:  # noqa: BLE001 单任务失败隔离
                task.retry_count += 1
                task.status = 0 if task.retry_count < _MAX_RETRY else 2
                logger.warning("瓦片下载失败 %s/%d/%d/%d：%s", source_key, task.z, task.x, task.y, exc)
        db.flush()
        for region_id in affected:
            done = db.scalar(select(func.count()).select_from(MapDownloadTask).where(
                MapDownloadTask.region_id == region_id, MapDownloadTask.status == 1)) or 0
            pending = db.scalar(select(func.count()).select_from(MapDownloadTask).where(
                MapDownloadTask.region_id == region_id, MapDownloadTask.status == 0)) or 0
            region = db.get(MapCacheRegion, region_id)
            if region is None:
                continue
            region.tile_count = done
            if pending == 0 and region.status != 3:
                region.status = 2
                region.last_download_at = datetime.now()
        db.commit()
    finally:
        db.close()


download_worker_tick.interval_minutes = 1 / 12  # 约 5 秒一轮
