"""map 模块：区域下载任务生成器（异步化——多用户并发与超时治理批次）。

设计（替代原 start_region_download 在请求线程内逐条 EXISTS + 逐行 INSERT）：
- 新增区域状态 4 = 任务生成中：start 接口只做纯数学估算并置 4 后**毫秒级返回**；
  本模块定时任务（约 10 秒一轮）按 zoom 升序分批推进缺失任务的批量插入；
- 差集批量插入：一条索引查询载入已有 (z,x,y) 集合 → 纯内存计算「bbox 数学展开 − 已有集合」
  → 分块（每块 ≤2000 行）bulk 插入。幂等由差集 + uk_region_xyz 唯一键双重保证；
- 防 worker 提前完成：生成期间区域保持 4；download_worker 的完成判定收紧为仅 status==1，
  全部级别无缺失时由本模块翻转 4→1 交给现有 worker 下载。状态在库里，跨重启自然续跑。
"""
from __future__ import annotations

import json
import logging
import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.modules.map.models import MapCacheRegion, MapDownloadTask

logger = logging.getLogger("app.map.generator")

STATUS_IDLE = 0        # 未开始（生成异常时的回退态，用户可重试）
STATUS_RUNNING = 1     # 下载中（worker 只对该状态判定完成）
STATUS_GENERATING = 4  # 任务生成中（本模块驱动）

MAX_TILES_PER_REGION = 1_000_000  # start 接口纯数学估算上限（超过直接业务拒绝）
_BATCH_ROWS = 2_000               # 单块 INSERT 行数
_MAX_ROWS_PER_TICK = 50_000       # 每 tick 单区域单 zoom 级别插入上限（单级缺失超限则下轮续跑）
_MAX_REGIONS_PER_TICK = 2         # 每 tick 最多推进的区域数（防饿死其他任务）


def tile_bbox_to_xy_range(bbox: list[float], z: int) -> tuple[int, int, int, int]:
    """bbox [west, south, east, north] → (x0, x1, y0, y1)（Web Mercator 标准公式；自 api.py 迁入共享）。"""
    n = 2 ** z

    def lon2x(lon: float) -> int:
        return int((lon + 180.0) / 360.0 * n)

    def lat2y(lat: float) -> int:
        lat = max(min(lat, 85.05112878), -85.05112878)
        lat_rad = math.radians(lat)
        return int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)

    west, south, east, north = bbox
    return max(0, lon2x(west)), min(n - 1, lon2x(east)), max(0, lat2y(north)), min(n - 1, lat2y(south))


def region_bbox(region_geometry: str | None) -> list[float]:
    """解析并校验区域 geometry 的 bbox；不合法抛 ValueError（消息可直接向用户展示）。"""
    if not region_geometry:
        raise ValueError("区域缺少 geometry（需含 bbox）")
    try:
        geo = json.loads(region_geometry)
    except ValueError:
        raise ValueError("区域 geometry 不是合法 JSON") from None
    bbox = geo.get("bbox") if isinstance(geo, dict) else None
    if not bbox or len(bbox) != 4:
        raise ValueError("区域缺少 bbox（[west, south, east, north]）")
    west, south, east, north = bbox
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in bbox):
        raise ValueError("bbox 必须为 4 个数字")
    if east <= west or north <= south:
        raise ValueError("bbox 范围不正确（需 east>west 且 north>south）")
    return [float(west), float(south), float(east), float(north)]


def estimate_region_tiles(bbox: list[float], min_zoom: int, max_zoom: int) -> int:
    """纯数学估算 bbox×缩放级别的总瓦片数（零 DB 访问；start 接口上限校验用）。"""
    total = 0
    for z in range(min_zoom, max_zoom + 1):
        x0, x1, y0, y1 = tile_bbox_to_xy_range(bbox, z)
        total += (x1 - x0 + 1) * (y1 - y0 + 1)
    return total


def plan_missing_tiles(
    bbox: list[float],
    min_zoom: int,
    max_zoom: int,
    existing: set[tuple[int, int, int]],
) -> dict[int, list[tuple[int, int, int]]]:
    """bbox 数学展开 − 已有集合 → {z: [(z, x, y), ...]} 缺失清单。

    zoom 升序产出；层内先 x 后 y 升序——确定性顺序保证截断续跑语义稳定。
    """
    plan: dict[int, list[tuple[int, int, int]]] = {}
    for z in range(min_zoom, max_zoom + 1):
        x0, x1, y0, y1 = tile_bbox_to_xy_range(bbox, z)
        tiles = [
            (z, x, y)
            for x in range(x0, x1 + 1)
            for y in range(y0, y1 + 1)
            if (z, x, y) not in existing
        ]
        if tiles:
            plan[z] = tiles
    return plan


def next_level_batch(plan: dict[int, list[tuple[int, int, int]]]) -> tuple[int, list[tuple[int, int, int]]]:
    """取 zoom 升序第一个非空级别并截断到每 tick 上限；全部齐备返回 (-1, []) 表示生成完毕。"""
    for z in sorted(plan):
        rows = plan[z]
        if rows:
            return z, rows[:_MAX_ROWS_PER_TICK]
    return -1, []


def _load_existing_tiles(db: Session, region_id: int) -> set[tuple[int, int, int]]:
    """该区域已有任务集合（一条索引查询，替代逐条 EXISTS）。"""
    return {
        (int(z), int(x), int(y))
        for z, x, y in db.execute(
            select(MapDownloadTask.z, MapDownloadTask.x, MapDownloadTask.y)
            .where(MapDownloadTask.region_id == region_id)
        )
    }


def _insert_rows(db: Session, region_id: int, source_key: str, rows: list[tuple[int, int, int]]) -> int:
    """分块 bulk 插入并逐块 commit（uk_region_xyz 唯一键兜底任何残余并发重复）。"""
    created = 0
    for i in range(0, len(rows), _BATCH_ROWS):
        chunk = rows[i : i + _BATCH_ROWS]
        db.add_all([
            MapDownloadTask(region_id=region_id, source=source_key, z=z, x=x, y=y)
            for z, x, y in chunk
        ])
        db.commit()
        created += len(chunk)
    return created


def _advance_region(db: Session, region: MapCacheRegion, source_key: str) -> None:
    """单区域推进一步：插入一个 zoom 级别的缺失任务（≤50000 行）。

    无缺失且区域仍为生成中(4) → 翻转为下载中(1)，交给现有 worker。
    仅在 status==4 时才翻转：用户在生成期间的暂停(3)不会被覆盖（worker 也只认 1）。
    """
    bbox = region_bbox(region.geometry)
    existing = _load_existing_tiles(db, region.id)
    plan = plan_missing_tiles(bbox, region.min_zoom, region.max_zoom, existing)
    z, rows = next_level_batch(plan)
    if z < 0:
        if region.status == STATUS_GENERATING:
            logger.info("区域 %s 任务生成完毕，转入下载中", region.id)
            region.status = STATUS_RUNNING
            db.commit()
        return
    created = _insert_rows(db, region.id, source_key, rows)
    logger.info("区域 %s 生成 z=%s 缺失任务 %d 条（本 tick 上限 %d）", region.id, z, created, _MAX_ROWS_PER_TICK)


def _run_tick(db: Session, regions: list, source_key: str) -> None:
    """对给定区域逐一推进；单区域异常隔离：回滚并回置 status=0（用户可重试），不杀死整个 tick。"""
    for region in regions:
        try:
            _advance_region(db, region, source_key)
        except Exception as exc:  # noqa: BLE001 单区域异常隔离（参照 download_worker_tick 写法）
            db.rollback()
            logger.warning("区域 %s 任务生成失败：%s", getattr(region, "id", "?"), exc)
            try:
                region.status = STATUS_IDLE
                db.commit()
            except Exception:  # noqa: BLE001 回置失败也不影响其余区域
                db.rollback()


def _enabled_source_key(db: Session) -> str | None:
    """当前首个启用的图源 key（与 start 接口的选取逻辑一致）。"""
    from app.modules.map.services import config_store

    config = config_store.effective_config(db)
    return next((k for k, s in (config.get("map_sources") or {}).items() if s.get("enabled")), None)


def region_generate_tick() -> None:
    """模块定时任务（interval_minutes=1/6 ≈ 10 秒）：推进 status=4 区域的差集批量插入。"""
    db = SessionLocal()
    try:
        source_key = _enabled_source_key(db)
        if source_key is None:
            logger.debug("无启用地图源，跳过区域任务生成")
            return
        regions = db.scalars(
            select(MapCacheRegion)
            .where(MapCacheRegion.status == STATUS_GENERATING)
            .order_by(MapCacheRegion.id)
            .limit(_MAX_REGIONS_PER_TICK)
        ).all()
        if regions:
            _run_tick(db, regions, source_key)
    except Exception:  # noqa: BLE001 查询级异常不外泄（tick 由 APScheduler 调度，日志可查）
        logger.exception("区域任务生成 tick 异常")
    finally:
        db.close()


region_generate_tick.interval_minutes = 1 / 6  # 约 10 秒一轮（框架按此注册 APScheduler）
