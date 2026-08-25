"""map 模块：瓦片批量下载 worker（自适应并发提速，方案 §5.4/§9.2）。

- 消费 map_download_task（status=0 待下载），经 tile_cache 抓取落盘（容量/每日配额保护）。
- 失败重试 ≤2；区域（非暂停）无待下载任务后置「完成」并更新统计。
- 与瓦片清理接口共用 tile_cache.py 统一入口（进程锁，v2.1 ⑭）。
- 源：优先任务记录的 source；无记录/未配置回退当前首个启用源。

自适应提速（AIMD，进程内自愈、无需配置项）：
- 并发下限 2 / 上限 8 / 初始 4；每轮抓取在 ThreadPoolExecutor 内并行（DB 更新只在 tick 线程）。
- 上一轮全部成功 → 并发 +1；出现失败 → 并发减半（快速回退保护重试次数与上游礼貌）。
- 高失败率（>半数）→ 冷却 60s 暂停下载（上游故障/限流时不再持续撞墙）。
- 每日配额耗尽（TileQuotaExceeded）→ 从首个配额任务起剩余保留待下载、不烧重试次数，
  本轮已抓到的瓦片照常落库（磁盘命中即返回，下轮零成本补齐）。
- 吞吐对比：原串行 ≤20 瓦片/5s 轮；自适应满档 8×5=40 瓦片/批，网络健康时约 4~8 倍提升。
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy import func, select

from app.db import SessionLocal
from app.modules.map.models import MapCacheRegion, MapDownloadTask
from app.modules.map.services import config_store, tile_cache
from app.modules.map.services.tile_cache import TileQuotaExceeded

logger = logging.getLogger("app.map.download")

_CONC_MIN = 2
_CONC_MAX = 8
_CONC_START = 4
_BATCHES_PER_TICK = 5  # 每轮批次上限：limit ≈ 并发 × 5（最坏一轮 ≈ 5 × 单瓦片超时 15s）
_COOLDOWN_SECONDS = 60.0

# 进程内自适应状态（APScheduler max_instances=1 保证同一 job 不并发进入 tick，无需加锁）
_concurrency = _CONC_START
_cooldown_until = 0.0  # monotonic；> now 表示冷却中
_last_tick = [0, 0]  # [上一轮成功数, 上一轮失败数]


def _adjust_concurrency(successes: int, failures: int) -> tuple[int, float]:
    """根据上一轮成败调整并发（纯函数便于测试）。返回 (新并发, 冷却秒数)。"""
    if successes == 0 and failures == 0:
        return _concurrency, 0.0
    if failures > 0:
        new_conc = max(_CONC_MIN, _concurrency // 2)
        # 失败占多数视为上游异常（限流/故障）：冷却暂停，避免持续无效请求消耗重试次数
        cooldown = _COOLDOWN_SECONDS if failures > successes else 0.0
        return new_conc, cooldown
    return min(_CONC_MAX, _concurrency + 1), 0.0


def _fetch_one(src_cfg: dict, source_key: str, z: int, x: int, y: int) -> tuple[str, Exception | None]:
    """线程池内单瓦片抓取（只做网络+落盘，不碰 DB 会话）。返回 ("ok"/"quota"/"fail", 异常)。"""
    try:
        data = tile_cache.get_tile(src_cfg, source_key, z, x, y)
        if not data:
            raise ValueError("瓦片数据为空")
        return "ok", None
    except TileQuotaExceeded as exc:
        return "quota", exc
    except Exception as exc:  # noqa: BLE001 单任务失败隔离（超时/HTTP错误/磁盘等）
        return "fail", exc


def download_worker_tick() -> None:
    """批量下载一轮（自适应并发，≤并发×5 个任务；异常隔离：单任务失败仅标失败/重试）。

    源：优先任务记录的 source（migration 0001）；无记录/未配置回退当前首个启用源。
    """
    global _concurrency, _cooldown_until

    now = time.monotonic()
    if now < _cooldown_until:
        logger.debug("下载冷却中（剩余 %.0fs），本轮跳过", _cooldown_until - now)
        return
    _concurrency, cooldown = _adjust_concurrency(_last_tick[0], _last_tick[1])
    if cooldown > 0.0:
        _cooldown_until = time.monotonic() + cooldown
        logger.warning(
            "瓦片下载失败率过高（成 %d / 败 %d），冷却 %.0fs 后以并发 %d 重试",
            _last_tick[0], _last_tick[1], cooldown, _concurrency,
        )
        return

    db = SessionLocal()
    try:
        config = config_store.effective_config(db)
        sources = config.get("map_sources") or {}
        default_key = next((k for k, s in sources.items() if s.get("enabled")), None)
        if default_key is None:
            return
        limit = _concurrency * _BATCHES_PER_TICK
        rows = db.execute(
            select(MapDownloadTask, MapCacheRegion)
            .join(MapCacheRegion, MapCacheRegion.id == MapDownloadTask.region_id)
            .where(MapDownloadTask.status == 0, MapCacheRegion.status != 3)
            .order_by(MapDownloadTask.id)
            .limit(limit)
        ).all()
        if not rows:
            return

        # 解析各任务的源配置（tick 线程内完成，工作线程只负责抓取）
        jobs: list[tuple[MapDownloadTask, str, dict]] = []
        for task, _region in rows:
            source_key = (task.source or "") if (task.source or "") in sources else default_key
            src = sources.get(source_key)
            if src is None:
                task.status = 2
                task.retry_count += 1
                continue
            jobs.append((task, source_key, src))

        results: dict[int, tuple[str, Exception | None]] = {}
        quota_hit = False
        if jobs:
            with ThreadPoolExecutor(max_workers=_concurrency, thread_name_prefix="map-dl") as pool:
                futures = {
                    pool.submit(_fetch_one, src, key, t.z, t.x, t.y): t.id
                    for t, key, src in jobs
                }
                for fut, task_id in futures.items():
                    outcome = fut.result()
                    results[task_id] = outcome
                    if outcome[0] == "quota":
                        quota_hit = True

        # DB 状态更新（仅 tick 线程）；按提交顺序应用结果，首个配额异常之后的任务保持待下载
        affected: set[int] = set()
        ok_count = fail_count = kept_count = 0
        for task, source_key, _src in jobs:
            kind, exc = results.get(task.id, ("", None))
            if kind == "ok":
                affected.add(task.region_id)
                task.status = 1
                ok_count += 1
            elif kind == "quota":
                kept_count += 1  # 该任务及其后全部保留待下载（不烧重试次数）
            elif kind == "fail":
                affected.add(task.region_id)
                task.retry_count += 1
                task.status = 0 if task.retry_count < _MAX_RETRY else 2
                fail_count += 1
                logger.warning(
                    "瓦片下载失败 %s/%d/%d/%d：%s", source_key, task.z, task.x, task.y, exc,
                )
            else:  # 配额中止后未执行的任务
                kept_count += 1
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

        if quota_hit:
            logger.info("今日瓦片下载配额已用尽：本轮成功 %d，%d 个任务保留待下载（次日配额恢复自动续跑）",
                        ok_count, kept_count)
        elif ok_count or fail_count:
            logger.info("下载轮完成：成功 %d / 失败 %d（并发 %d）", ok_count, fail_count, _concurrency)

        _last_tick[:] = [ok_count, fail_count]
    finally:
        db.close()


download_worker_tick.interval_minutes = 1 / 12  # 约 5 秒一轮
