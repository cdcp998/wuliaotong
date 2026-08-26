"""map 模块接口（地图：图源配置/瓦片代理/缓存区域批量下载，方案 §5.4 / §9.2）。

router 级依赖：require_module_enabled("map")——模块未启用时全部接口 403（方案 §13.1.2）。
依赖：cable 模块（地图工作台展示线缆/故障数据；cable:view 权限由 cable 模块注册）。
"""
from __future__ import annotations

import ipaddress
import json
import logging
import time
import urllib.request
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_any_permission, require_permission
from app.core.modules import require_module_enabled
from app.core.response import BizError, E_NOT_FOUND, E_PARAM, ok
from app.db import SessionLocal, get_db
from app.modules.map.models import MapCacheRegion, MapDownloadTask
from app.modules.map.schemas import MapSourceIn, RegionCreate, RegionUpdate
from app.modules.map.services import config_store, region_generator, tile_cache

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


def _read_source_config(db: Session, source: str) -> dict:
    """读取该图源配置（含 enabled 校验）；仅在调用方提供的短会话内执行。"""
    config = config_store.effective_config(db)
    src = (config.get("map_sources") or {}).get(source)
    if src is None or not src.get("enabled", False):
        raise BizError(E_NOT_FOUND, f"地图源 {source} 未配置")
    return src


# ============================ IP 定位兜底（iOS 等非安全上下文无浏览器定位） ============================
# 背景：Geolocation API 仅安全上下文（HTTPS/localhost）可用，HTTP 内网部署的 iOS 浏览器拿不到；
# 前端直连公网 IP 服务还受 CORS/混合内容/网络可达性限制。由后端代理查询规避全部浏览器侧限制。
_IP_LOOKUP_TIMEOUT = 4  # 单个上游 IP 服务超时（秒）


def _is_private_ip(host: str | None) -> bool:
    """内网/环回/链路本地地址判定：此类地址无法被公网 IP 服务解析。

    设备在 NAT 后时客户端地址为私网 → 改查「不带 IP」的服务端出口定位
    （同一办公网出口与设备实际位置同量级——城市级粗定位）。
    """
    if not host:
        return True
    try:
        addr = ipaddress.ip_address(host.strip())
    except ValueError:
        return True
    return addr.is_private or addr.is_loopback or addr.is_link_local or not addr.is_global


def _parse_ip_api(payload: dict) -> tuple[float, float] | None:
    """ip-api.com 响应 → (lat, lng)；结构不符返回 None。"""
    if payload.get("status") == "success" and isinstance(payload.get("lat"), (int, float)) \
            and isinstance(payload.get("lon"), (int, float)):
        return float(payload["lat"]), float(payload["lon"])
    return None


def _parse_geojs(payload: dict) -> tuple[float, float] | None:
    """get.geojs.io 响应 → (lat, lng)；结构不符返回 None。"""
    try:
        lat, lng = float(payload["latitude"]), float(payload["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    return (lat, lng) if lat or lng else None


def _fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "wuliaotong-map-proxy/1.0"})
    with urllib.request.urlopen(req, timeout=_IP_LOOKUP_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


@router.get("/map/ip-locate", dependencies=[Depends(require_permission("cable:view"))])
def ip_locate(request: Request) -> dict:
    """IP 定位兜底：后端代理查询公网 IP 库（WGS84 城市级粗定位；不持 DB 会话）。

    客户端 IP 取 X-Forwarded-For 首段 / 直连地址；私网地址则让上游按服务器出口 IP 解析。
    """
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    client_ip = forwarded or (request.client.host if request.client else "")
    # 公网客户端 IP 显式查询；私网（NAT 后设备）→ 空 suffix 让上游按服务器出口解析
    suffix = f"/{client_ip}" if not _is_private_ip(client_ip) else ""
    errors: list[str] = []
    for parse, url in (
        (_parse_ip_api, f"http://ip-api.com/json{suffix}?fields=status,message,lat,lon"),
        (_parse_geojs, f"https://get.geojs.io/v1/ip/geo{suffix}.json"),
    ):
        try:
            parsed = parse(_fetch_json(url))
        except Exception as exc:  # noqa: BLE001 单一上游失败尝试下一个
            errors.append(f"{url.split('/')[2]}: {exc}")
            continue
        if parsed is not None:
            lat, lng = parsed
            return ok({"lat": lat, "lng": lng})
    logger.warning("IP 定位失败 %s：%s", client_ip or "-", "; ".join(errors))
    raise BizError(E_PARAM, "IP 定位服务暂不可用")


@router.get("/map/tile/{source}/{z}/{x}/{y}", dependencies=[Depends(require_permission("cable:view"))])
def tile_proxy(source: str, z: int, x: int, y: int) -> Response:
    """瓦片代理：缓存优先 → 在线源抓取落盘（方案 §5.4）。

    多用户并发加固：短生命周期会话**只做一件事**——读配置并取出该源配置 dict，随即关闭；
    之后的慢 IO（tile_cache 磁盘/上游抓取，最长 15s）绝不持有任何 DB 会话/连接，
    避免多用户同时浏览未缓存区域时慢请求占满连接池与线程池、拖垮全站业务接口。
    保持同步 def（urllib 阻塞抓取由 anyio 线程池承载；路由级鉴权依赖为快路径，不动）。
    """
    if not (0 <= z <= TILE_MAX_ZOOM) or x < 0 or y < 0 or x >= 2 ** z or y >= 2 ** z:
        raise BizError(E_PARAM, "瓦片坐标越界")
    with SessionLocal() as db:  # 短会话：配置读出即结束
        src_cfg = _read_source_config(db, source)
    # ↑ 会话已关闭；以下为纯网络/磁盘 IO（无任何打开的 SQLAlchemy 会话）
    try:
        data = tile_cache.get_tile(src_cfg, source, z, x, y)
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
    rows = db.scalars(select(MapCacheRegion).order_by(MapCacheRegion.id.desc())).all()

    # 每区域任务瓦片集合（单条全量查询；同时供孤儿判定与各区域磁盘占用汇总，避免重复扫描）
    region_pieces: dict[int, dict[str, set[tuple[int, int, int]]]] = {}
    for rid, source, z, x, y in db.execute(
        select(MapDownloadTask.region_id, MapDownloadTask.source, MapDownloadTask.z,
               MapDownloadTask.x, MapDownloadTask.y)
    ):
        region_pieces.setdefault(rid, {}).setdefault(source or "", set()).add((int(z), int(x), int(y)))
    kept: dict[str, set[tuple[int, int, int]]] = {}
    for pieces_by_source in region_pieces.values():
        for s, coords in pieces_by_source.items():
            kept.setdefault(s, set()).update(coords)

    # 孤儿瓦片统计（不属于任何下载任务的磁盘文件）→ 归入「默认缓存」
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

    # 各任务区域磁盘占用**实时如实统计**（不区分进行中/暂停/已完成）：
    # 按增量注册表现算实际落盘字节——失败但已有文件的瓦片照常计入，下不到的天然计 0；
    # 「暂停即见当前占用」，完成时刻的写入（worker）与本处口径一致。
    for r in rows:
        if r.name == DEFAULT_REGION_NAME:
            continue
        pieces = [
            (s, z, x, y)
            for s, coords in region_pieces.get(r.id, {}).items()
            for (z, x, y) in coords
        ]
        r.cache_size = tile_cache.total_size_for(pieces)
    db.commit()

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
    """启动区域下载（异步化）：校验通过后**纯数学估算**总量，置状态 4（任务生成中）立即返回。

    任务由后台 region_generate_tick 按 zoom 升序分批差集插入（幂等），全部就绪后自动转
    「下载中(1)」交由 download_worker 抓取。请求耗时恒定毫秒级，大区域不再长时间占用
    请求线程/连接池；两个管理员同时启动不同区域互不拖累。
    """
    r = db.get(MapCacheRegion, region_id)
    if r is None:
        raise BizError(E_NOT_FOUND, "缓存区域不存在")
    if r.name == DEFAULT_REGION_NAME:
        raise BizError(E_PARAM, "「默认缓存」为浏览自动收集，无需手动下载")
    # 幂等：下载中(1)/任务生成中(4)直接返回；暂停(3)允许重新评估续跑（差集幂等）
    if r.status in (1, 4):
        return ok({"message": "下载已在进行中"})
    config = config_store.load_config(db)
    source_key = next((k for k, s in config.get("map_sources", {}).items() if s.get("enabled")), None)
    if source_key is None:
        raise BizError(E_PARAM, "未配置启用的地图源")
    try:
        bbox = region_generator.region_bbox(r.geometry)
    except ValueError as exc:
        raise BizError(E_PARAM, str(exc)) from exc
    if r.min_zoom < 0 or r.max_zoom > TILE_MAX_ZOOM or r.min_zoom > r.max_zoom:
        raise BizError(E_PARAM, "缩放级别范围不合法")
    estimated = region_generator.estimate_region_tiles(bbox, r.min_zoom, r.max_zoom)
    if estimated > region_generator.MAX_TILES_PER_REGION:
        raise BizError(E_PARAM,
                       f"预估瓦片数 {estimated} 超过上限 {region_generator.MAX_TILES_PER_REGION}，"
                       "请缩小区域范围或降低缩放级别")
    r.status = region_generator.STATUS_GENERATING  # 4 = 任务生成中：由后台 tick 分批推进
    db.commit()
    return ok({"tiles_estimated": estimated})


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
