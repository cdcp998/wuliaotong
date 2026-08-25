"""map 模块接口（地图：图源配置/瓦片代理/缓存区域批量下载，方案 §5.4 / §9.2）。

router 级依赖：require_module_enabled("map")——模块未启用时全部接口 403（方案 §13.1.2）。
依赖：cable 模块（地图工作台展示线缆/故障数据；cable:view 权限由 cable 模块注册）。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_any_permission, require_permission
from app.core.modules import require_module_enabled
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.modules.map.models import MapCacheRegion, MapDownloadTask
from app.modules.map.schemas import MapSourceIn, RegionCreate, RegionUpdate
from app.modules.map.services import config_store, tile_cache

logger = logging.getLogger("app.map")

router = APIRouter(tags=["地图"], dependencies=[Depends(get_current_user), Depends(require_module_enabled("map"))])

TILE_MAX_ZOOM = 22
DEFAULT_REGION_NAME = "默认缓存"  # 收集代理浏览等非任务方式落盘的瓦片（无 bbox，不参与批量下载）


# ============================ 地图源 & 瓦片代理 ============================

@router.get("/map/sources", dependencies=[Depends(require_any_permission("map:config", "map:cache"))])
def map_sources(db: Session = Depends(get_db)) -> dict:
    config = config_store.effective_config(db)
    masked = config_store.mask_config(config)
    return ok({"map_sources": masked.get("map_sources", {}), "cache": masked.get("cache", {})})


@router.put("/map/sources", dependencies=[Depends(require_permission("map:config"))])
def save_map_sources(sources: list[MapSourceIn], db: Session = Depends(get_db)) -> dict:
    """保存地图源配置（按 key 合并；敏感字段加密入库，接口回读一律脱敏）。

    「******」哨兵值（脱敏视图回填表单）表示保持不变——不覆盖已存密钥。
    """
    config = config_store.effective_config(db)
    current = config.get("map_sources") or {}
    for s in sources:
        data = s.model_dump()
        prev = current.get(s.key) or {}
        for k in ("api_key", "api_secret"):
            if data.get(k) == "******":
                data[k] = prev.get(k, "")
        config["map_sources"][s.key] = data
    config_store.save_config(db, config)
    return ok({"saved": len(sources)})


@router.get("/map/tile-updated/{source}", dependencies=[Depends(require_permission("cable:view"))])
def tile_source_updated(source: str, db: Session = Depends(get_db)) -> dict:
    """图源更新时间：该源最近一次成功抓取瓦片的时间（地图右下角展示用）。"""
    config = config_store.effective_config(db)
    src = (config.get("map_sources") or {}).get(source)
    if src is None:
        raise BizError(E_NOT_FOUND, f"地图源 {source} 不存在")
    ts = tile_cache.source_updated_at(source)
    return ok({
        "source": source,
        "updated_at": datetime.fromtimestamp(ts).isoformat() if ts else None,
    })


@router.get("/map/tile/{source}/{z}/{x}/{y}", dependencies=[Depends(require_permission("cable:view"))])
def tile_proxy(source: str, z: int, x: int, y: int, db: Session = Depends(get_db)) -> Response:
    """瓦片代理：缓存优先 → 在线源抓取落盘（方案 §5.4）。"""
    if not (0 <= z <= TILE_MAX_ZOOM) or x < 0 or y < 0 or x >= 2 ** z or y >= 2 ** z:
        raise BizError(E_PARAM, "瓦片坐标越界")
    config = config_store.effective_config(db)
    src = (config.get("map_sources") or {}).get(source)
    if src is None or not src.get("enabled", False):
        raise BizError(E_NOT_FOUND, f"地图源 {source} 未配置")
    try:
        data = tile_cache.get_tile(src, source, z, x, y)
    except Exception as exc:  # noqa: BLE001
        logger.warning("瓦片抓取失败 %s/%d/%d/%d：%s", source, z, x, y, exc)
        raise BizError(E_PARAM, "瓦片获取失败，请检查地图源配置或网络") from exc
    return Response(content=data, media_type="image/png")


@router.delete("/map/sources/{source_key}", dependencies=[Depends(require_permission("map:config"))])
def delete_map_source(source_key: str, db: Session = Depends(get_db)) -> dict:
    """删除自定义地图源（内置默认 esri 不可删除——空配置时有效配置会自动回退重建）。

    删除后若剩余源均未启用，瓦片代理将不可用（提示先启用其他源）。
    """
    config = config_store.load_config(db)
    sources = config.get("map_sources") or {}
    if source_key not in sources:
        raise BizError(E_NOT_FOUND, f"地图源 {source_key} 不存在")
    config["map_sources"].pop(source_key, None)
    config_store.save_config(db, config)
    return ok({"removed": source_key, "remaining": len(config["map_sources"])})


@router.put("/map/config", dependencies=[Depends(require_permission("map:config"))])
def save_map_config(config: dict, db: Session = Depends(get_db)) -> dict:
    current = config_store.load_config(db)
    if not current.get("map_sources"):
        current = config_store.default_config()
    current.update(config)
    config_store.save_config(db, current)
    return ok()


# ============================ 缓存区域（批量下载） ============================

def _ensure_default_region(db: Session) -> MapCacheRegion:
    """「默认缓存」行：get_or_create（幂等）。收集代理浏览等非任务方式落盘的瓦片。"""
    r = db.scalar(select(MapCacheRegion).where(MapCacheRegion.name == DEFAULT_REGION_NAME))
    if r is None:
        r = MapCacheRegion(name=DEFAULT_REGION_NAME, min_zoom=0, max_zoom=TILE_MAX_ZOOM,
                           update_mode="manual", status=2)
        db.add(r)
        db.commit()
        db.refresh(r)
    return r


def _kept_task_tiles(db: Session) -> dict[str, set[tuple[int, int, int]]]:
    """全部下载任务覆盖的瓦片集合（按源分组）——磁盘上其余瓦片即「默认缓存」收集的孤儿瓦片。"""
    kept: dict[str, set[tuple[int, int, int]]] = {}
    for source, z, x, y in db.execute(
        select(MapDownloadTask.source, MapDownloadTask.z, MapDownloadTask.x, MapDownloadTask.y)
    ):
        kept.setdefault(source or "", set()).add((int(z), int(x), int(y)))
    return kept


@router.get("/map/cache/regions", dependencies=[Depends(require_permission("map:cache"))])
def list_regions(db: Session = Depends(get_db)) -> dict:
    """区域列表（含「默认缓存」孤儿瓦片统计；瓦片统计走增量注册表——

    写入自动登记/清理自动注销，本接口 O(n) 内存拷贝、零磁盘扫描；
    仅本模块感知不到的外部改动由后台对账任务（默认 10 分钟）纠偏）。
    """
    default_row = _ensure_default_region(db)
    # 孤儿瓦片统计（不属于任何下载任务的磁盘文件）→ 归入「默认缓存」
    kept = _kept_task_tiles(db)
    orphan_count = 0
    orphan_size = 0
    for source, z, x, y, size in tile_cache.scan_tiles():
        if (z, x, y) not in kept.get(source, set()):
            orphan_count += 1
            orphan_size += size
    default_row.tile_count = orphan_count
    default_row.cache_size = orphan_size
    if orphan_count > 0 and default_row.last_download_at is None:
        default_row.last_download_at = datetime.now()
    db.commit()

    rows = db.scalars(select(MapCacheRegion).order_by(MapCacheRegion.id.desc())).all()
    return ok([
        {
            "id": r.id, "name": r.name, "geometry": json.loads(r.geometry) if r.geometry else None,
            "min_zoom": r.min_zoom, "max_zoom": r.max_zoom, "tile_count": r.tile_count,
            "cache_size": r.cache_size, "last_download_at": r.last_download_at.isoformat() if r.last_download_at else None,
            "update_mode": r.update_mode, "status": r.status,
            "is_default": r.name == DEFAULT_REGION_NAME,
        }
        for r in rows
    ])


@router.put("/map/cache/regions/{region_id}", dependencies=[Depends(require_permission("map:cache"))])
def update_region(region_id: int, req: RegionUpdate, db: Session = Depends(get_db)) -> dict:
    """编辑缓存区域（名称/框选范围/缩放级别/更新模式；「默认缓存」为系统聚合行不可编辑）。"""
    r = db.get(MapCacheRegion, region_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "缓存区域不存在")
    if r.name == DEFAULT_REGION_NAME:
        raise BizError(E_PARAM, "「默认缓存」由系统自动收集，不可编辑")
    if req.min_zoom < 0 or req.max_zoom > TILE_MAX_ZOOM or req.min_zoom > req.max_zoom:
        raise BizError(E_PARAM, "缩放级别范围不合法")
    r.name = req.name.strip() or r.name
    if req.geometry is not None:
        r.geometry = json.dumps(req.geometry, ensure_ascii=False)
    r.min_zoom = req.min_zoom
    r.max_zoom = req.max_zoom
    r.update_mode = req.update_mode
    db.commit()
    return ok({"id": r.id})


@router.post("/map/cache/regions", dependencies=[Depends(require_permission("map:cache"))])
def create_region(req: RegionCreate, db: Session = Depends(get_db)) -> dict:
    if req.min_zoom < 0 or req.max_zoom > TILE_MAX_ZOOM or req.min_zoom > req.max_zoom:
        raise BizError(E_PARAM, "缩放级别范围不合法")
    r = MapCacheRegion(
        name=req.name, geometry=json.dumps(req.geometry, ensure_ascii=False) if req.geometry else None,
        min_zoom=req.min_zoom, max_zoom=req.max_zoom, update_mode=req.update_mode,
    )
    db.add(r)
    db.commit()
    return ok({"id": r.id})


@router.post("/map/cache/regions/{region_id}/start", dependencies=[Depends(require_permission("map:cache"))])
def start_region_download(region_id: int, db: Session = Depends(get_db)) -> dict:
    """启动区域下载：生成任务并保持「下载中」，由 worker 逐轮抓取、完成后置「完成」。"""
    r = db.get(MapCacheRegion, region_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "缓存区域不存在")
    if r.name == DEFAULT_REGION_NAME:
        raise BizError(E_PARAM, "「默认缓存」为浏览自动收集，无需手动下载")
    if r.status == 1:
        return ok({"message": "下载已在进行中"})
    config = config_store.load_config(db)
    source_key = next((k for k, s in config.get("map_sources", {}).items() if s.get("enabled")), None)
    if source_key is None:
        raise BizError(E_PARAM, "未配置启用的地图源")
    r.status = 1
    db.commit()
    try:
        created = _download_region_tiles(db, r, source_key)
    except Exception as exc:  # noqa: BLE001
        r.status = 3
        db.commit()
        raise BizError(E_PARAM, f"生成下载任务失败：{exc}") from exc
    # 有剩余待下载任务 → 保持「下载中」，由 worker 逐轮抓取、完成后置「完成」
    pending = db.scalar(select(func.count()).select_from(MapDownloadTask).where(
        MapDownloadTask.region_id == r.id, MapDownloadTask.status == 0)) or 0
    if pending == 0:
        r.status = 2
        r.last_download_at = datetime.now()
    else:
        r.status = 1
    db.commit()
    return ok({"tiles_queued": created})


def _tile_bbox_to_xy_range(bbox: list[float], z: int) -> tuple[int, int, int, int]:
    """bbox [west, south, east, north] → (x0, x1, y0, y1)（Web Mercator 标准公式）。"""
    import math

    n = 2 ** z

    def lon2x(lon: float) -> int:
        return int((lon + 180.0) / 360.0 * n)

    def lat2y(lat: float) -> int:
        lat = max(min(lat, 85.05112878), -85.05112878)
        lat_rad = math.radians(lat)
        return int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)

    west, south, east, north = bbox
    return max(0, lon2x(west)), min(n - 1, lon2x(east)), max(0, lat2y(north)), min(n - 1, lat2y(south))


@router.post("/map/cache/regions/{region_id}/pause", dependencies=[Depends(require_permission("map:cache"))])
def pause_region_download(region_id: int, db: Session = Depends(get_db)) -> dict:
    """暂停区域下载（worker 跳过暂停区域；恢复=再次 start）。"""
    r = db.get(MapCacheRegion, region_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "缓存区域不存在")
    r.status = 3
    db.commit()
    return ok()


@router.post("/map/cache/regions/{region_id}/clear", dependencies=[Depends(require_permission("map:cache"))])
def clear_region(region_id: int, db: Session = Depends(get_db)) -> dict:
    """清理区域缓存：删除该区域下载任务 + 按 source/z/x/y 精确删除磁盘瓦片（统一入口 tile_cache）
    + 重置统计（与下载 worker 共用进程锁；正在写的瓦片删除后幂等重抓）。"""
    from sqlalchemy import delete

    r = db.get(MapCacheRegion, region_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "缓存区域不存在")
    # 「默认缓存」：只清理孤儿瓦片（不属于任何下载任务的磁盘文件），不动任务区域
    if r.name == DEFAULT_REGION_NAME:
        kept = _kept_task_tiles(db)
        result = tile_cache.clear_orphan_tiles(kept)
        r.tile_count = 0
        r.cache_size = 0
        db.commit()
        return ok({"tiles_removed": result["removed"], "freed_bytes": result["freed_bytes"]})
    tasks = db.execute(
        select(MapDownloadTask.source, MapDownloadTask.z, MapDownloadTask.x, MapDownloadTask.y)
        .where(MapDownloadTask.region_id == region_id)
    ).all()
    by_source: dict[str, list[tuple[int, int, int]]] = {}
    for source, z, x, y in tasks:
        by_source.setdefault(source or "", []).append((int(z), int(x), int(y)))
    for source, pieces in by_source.items():
        if source:
            tile_cache.clear_tiles_for(source, pieces)
        else:
            tile_cache.clear_tiles()  # 无 source 记录的历史任务：全量清理兜底
    db.execute(delete(MapDownloadTask).where(MapDownloadTask.region_id == region_id))
    r.tile_count = 0
    r.cache_size = 0
    r.status = 0
    r.last_download_at = None
    db.commit()
    return ok({"tiles_removed": sum(len(v) for v in by_source.values())})


@router.get("/map/downloads", dependencies=[Depends(require_permission("map:cache"))])
def download_progress(db: Session = Depends(get_db)) -> dict:
    """下载进度（全局 + 分区域统计：pending/done/failed/total）。"""
    global_pending = db.scalar(select(func.count()).select_from(MapDownloadTask).where(MapDownloadTask.status == 0)) or 0
    global_done = db.scalar(select(func.count()).select_from(MapDownloadTask).where(MapDownloadTask.status == 1)) or 0
    global_failed = db.scalar(select(func.count()).select_from(MapDownloadTask).where(MapDownloadTask.status == 2)) or 0
    regions = db.scalars(select(MapCacheRegion).order_by(MapCacheRegion.id.desc())).all()
    # 一次 group by 得到各区域 (pending, done, failed) 统计
    by_region: dict[int, dict[int, int]] = {}
    for region_id, status, count in db.execute(
        select(MapDownloadTask.region_id, MapDownloadTask.status, func.count())
        .group_by(MapDownloadTask.region_id, MapDownloadTask.status)
    ):
        by_region.setdefault(region_id, {})[status] = count
    per_region = []
    for r in regions:
        stat = by_region.get(r.id, {})
        pending = stat.get(0, 0)
        done = stat.get(1, 0)
        failed = stat.get(2, 0)
        per_region.append({
            "id": r.id, "name": r.name, "status": r.status, "tile_count": r.tile_count,
            "pending": pending, "done": done, "failed": failed,
            "total": pending + done + failed,
            "last_download_at": r.last_download_at.isoformat() if r.last_download_at else None,
        })
    return ok({"pending": global_pending, "done": global_done, "failed": global_failed, "regions": per_region})


def _download_region_tiles(db: Session, region: MapCacheRegion, source_key: str) -> int:
    """生成区域瓦片下载任务（uk(region_id,z,x,y) 幂等；记录 source 供 worker/清理使用）。"""
    if not region.geometry:
        raise BizError(E_PARAM, "区域缺少 geometry（需含 bbox）")
    try:
        geo = json.loads(region.geometry)
    except ValueError:
        raise BizError(E_PARAM, "区域 geometry 不是合法 JSON") from None
    bbox = geo.get("bbox") if isinstance(geo, dict) else None
    if not bbox or len(bbox) != 4:
        raise BizError(E_PARAM, "区域缺少 bbox（[west, south, east, north]）")
    created = 0
    for z in range(region.min_zoom, region.max_zoom + 1):
        x0, x1, y0, y1 = _tile_bbox_to_xy_range(bbox, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                exists = db.scalar(
                    select(MapDownloadTask.id).where(
                        MapDownloadTask.region_id == region.id,
                        MapDownloadTask.z == z, MapDownloadTask.x == x, MapDownloadTask.y == y,
                    )
                )
                if exists:
                    continue
                db.add(MapDownloadTask(region_id=region.id, source=source_key, z=z, x=x, y=y))
                created += 1
    db.commit()
    return created
