"""map 模块：瓦片磁盘缓存与代理抓取（线缆和设备插件方案 §5.4 / §9.2）。

- 磁盘缓存优先命中 → 未命中按源 url_template 抓在线源并落盘（.png + .meta.json）。
- 容量保护：cache.max_size（字节）、download.max_daily（每日抓取上限，进程内计数）。
- 瓦片清理统一入口：clear_tiles()（worker 与清理接口共用，v2.1 ⑭）。
- 瓦片统计走**增量注册表**（进程内，事件驱动自动更新）：写入即登记、清理即注销，
  区域列表等统计请求 O(注册表大小) 拷贝、**永不触发全盘扫描**；
  仅后台对账任务（reconcile_scan_cache，默认 10 分钟）周期性强制重扫，
  自愈外部改动（手工删目录/备份还原等本模块感知不到的磁盘变化）。
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
import urllib.request
from pathlib import Path

from app.config import BASE_DIR

logger = logging.getLogger("app.cable.tile_cache")

TILE_CACHE_ROOT = Path(os.getenv("CABLE_TILE_CACHE_DIR", str(BASE_DIR / "data" / "tile_cache")))
_MAX_TILE_BYTES = 5 * 1024 * 1024  # 单瓦片上限（异常大视为错误响应）
_HTTP_TIMEOUT = 15
_lock = threading.Lock()
_daily_counter = {"date": "", "count": 0}  # 进程内每日抓取计数（简单实现，多进程部署需共享存储）
# 缓存策略（用户要求）：瓦片**永不自动清理/过期**——磁盘命中即返回；
# 仅管理员在「地图缓存管理」手动清理（clear_tiles / clear_tiles_for / clear_orphan_tiles）。
# cache_ttl 参数保留兼容旧调用，但 None 一律视为永久。

# ============================ 增量统计注册表 ============================
# key=(source, z, x, y) → size_bytes。全部读写持 _lock（操作为 µs 级 dict 变更，
# 与清理由同一把锁定序：先删文件后注销，统计不会看到已删仍计数的中间态）。
_tile_registry: dict[tuple[str, int, int, int], int] = {}
_registry_ready = False  # 冷启动标记：首次统计调用时从磁盘装载一次，之后纯增量维护


class TileQuotaExceeded(ValueError):
    """今日瓦片下载配额已用尽（区别于普通失败：不应消耗任务重试次数）。"""


def _register_tile(source: str, z: int, x: int, y: int, size: int) -> None:
    """瓦片成功落盘后登记（get_tile 写入路径调用）。"""
    with _lock:
        _tile_registry[(source, z, x, y)] = size


def _parse_tile_path(p: Path) -> tuple[str, int, int, int] | None:
    """磁盘 png 路径 → 注册表 key；解析失败（脏文件）返回 None。"""
    try:
        rel = p.relative_to(TILE_CACHE_ROOT)
        source = rel.parts[0]
        z, x, y = int(rel.parts[1]), int(rel.parts[2]), int(rel.parts[3].removesuffix(".png"))
        return source, z, x, y
    except (ValueError, IndexError):
        return None


def _walk_tiles_to_dict() -> dict[tuple[str, int, int, int], int]:
    """全盘扫描 → {key: size}（仅在冷启动装载与后台对账时调用，不在请求路径上）。"""
    out: dict[tuple[str, int, int, int], int] = {}
    if not TILE_CACHE_ROOT.exists():
        return out
    for p in TILE_CACHE_ROOT.rglob("*.png"):
        key = _parse_tile_path(p)
        if key is None:
            continue
        try:
            out[key] = p.stat().st_size
        except OSError:
            continue
    return out


def _tile_path(source: str, z: int, x: int, y: int) -> Path:
    return TILE_CACHE_ROOT / source / str(z) / str(x) / f"{y}.png"


def _meta_path(source: str, z: int, x: int, y: int) -> Path:
    return _tile_path(source, z, x, y).with_suffix(".meta.json")


def _source_meta_path(source: str) -> Path:
    """每源最近更新时间标记（本进程最后一次成功抓取在线源的时间）。"""
    return TILE_CACHE_ROOT / source / "__source_meta__.json"


def _write_source_meta(source: str, fetched_at: int) -> None:
    """原子写入源更新时间标记（抓取成功落盘后调用；失败不影响主流程）。"""
    try:
        p = _source_meta_path(source)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps({"fetched_at": fetched_at}), encoding="utf-8")
        os.replace(tmp, p)
    except OSError as exc:  # noqa: BLE001 标记文件失败不影响瓦片
        logger.debug("写入源更新时间标记失败 %s：%s", source, exc)


def source_updated_at(source: str) -> float | None:
    """该源最近一次成功抓取瓦片的时间戳（无记录返回 None）。"""
    try:
        p = _source_meta_path(source)
        if not p.exists():
            return None
        return float(json.loads(p.read_text(encoding="utf-8")).get("fetched_at") or 0) or None
    except (OSError, ValueError):
        return None


def _daily_ok(max_daily: int) -> bool:
    """每日抓取配额（默认 0=不限）。"""
    if max_daily <= 0:
        return True
    today = time.strftime("%Y-%m-%d")
    with _lock:
        if _daily_counter["date"] != today:
            _daily_counter.update(date=today, count=0)
        if _daily_counter["count"] >= max_daily:
            return False
        _daily_counter["count"] += 1
        return True


def fetch_remote(source_cfg: dict, z: int, x: int, y: int) -> bytes:
    """按源配置抓取瓦片（保证只使用配置的 url_template，禁止任意 URL）。"""
    template = source_cfg.get("url_template") or ""
    if not template:
        raise ValueError("地图源未配置 url_template")
    # 支持平台常见占位：{z}/{x}/{y}（XYZ）与 {z}/{y}/{x}（TMS/Esri）
    url = template.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": "wuliaotong-map-proxy/1.0"})
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
        data = resp.read()
    if len(data) > _MAX_TILE_BYTES:
        raise ValueError("瓦片数据异常过大，可能不是图片")
    return data


def get_tile(source_cfg: dict, source: str, z: int, x: int, y: int, cache_ttl: int | None = None) -> bytes:
    """代理读取瓦片：磁盘缓存命中即返回（**永不自动过期**）；未命中 → 抓在线源落盘并登记统计。

    cache_ttl 仅为兼容保留；传 None（默认）= 永久缓存，传正整数秒则该瓦片超过时效会刷新。
    """
    path = _tile_path(source, z, x, y)
    meta = _meta_path(source, z, x, y)
    if path.exists():
        expired = cache_ttl is not None and (time.time() - path.stat().st_mtime) > cache_ttl
        if not expired:
            return path.read_bytes()
        # 显式 TTL 场景才尝试刷新，失败时回退旧缓存（离线可用）
        try:
            data = fetch_remote(source_cfg, z, x, y)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            meta.write_text(json.dumps({"etag": "", "last_modified": "", "fetched_at": int(time.time())}), encoding="utf-8")
            _write_source_meta(source, int(time.time()))
            _register_tile(source, z, x, y, len(data))
            return data
        except Exception as exc:  # noqa: BLE001
            logger.warning("瓦片刷新失败，回退缓存 %s/%d/%d/%d：%s", source, z, x, y, exc)
            return path.read_bytes()
    if not _daily_ok(int(source_cfg.get("max_daily", 0))):
        raise TileQuotaExceeded("今日瓦片下载配额已用尽")
    data = fetch_remote(source_cfg, z, x, y)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    meta.write_text(json.dumps({"etag": "", "last_modified": "", "fetched_at": int(time.time())}), encoding="utf-8")
    _write_source_meta(source, int(time.time()))
    _register_tile(source, z, x, y, len(data))
    return data


def clear_tiles(source: str | None = None, before_ts: float | None = None) -> dict:
    """瓦片清理统一入口（下载 worker 与清理接口共用 + 进程锁，v2.1 ⑭）。

    扫描删除 .png + .meta.json；返回 {removed, freed_bytes}。
    删除的瓦片同步从统计注册表注销（与删除同锁同序，无需失效重扫）。
    """
    root = TILE_CACHE_ROOT / source if source else TILE_CACHE_ROOT
    if not root.exists():
        return {"removed": 0, "freed_bytes": 0}
    removed = 0
    freed = 0
    unregistered: list[tuple[str, int, int, int]] = []
    with _lock:
        for p in list(root.rglob("*.png")) + list(root.rglob("*.meta.json")):
            try:
                if before_ts is not None and p.stat().st_mtime >= before_ts:
                    continue
                size = p.stat().st_size
                p.unlink(missing_ok=True)
                removed += 1
                freed += size
                if p.suffix == ".png":
                    key = _parse_tile_path(p)
                    if key is not None:
                        unregistered.append(key)
            except OSError as exc:
                logger.warning("清理瓦片失败 %s：%s", p, exc)
        for key in unregistered:
            _tile_registry.pop(key, None)
    return {"removed": removed, "freed_bytes": freed}


def clear_tiles_for(source: str, pieces: list[tuple[int, int, int]]) -> dict:
    """按源精确清理指定瓦片（区域清理用；与 clear_tiles 共用进程锁，正在写的瓦片删除后幂等重抓）。"""
    removed = 0
    freed = 0
    with _lock:
        for z, x, y in pieces:
            for p in (_tile_path(source, z, x, y), _meta_path(source, z, x, y)):
                try:
                    if p.exists():
                        freed += p.stat().st_size
                        p.unlink()
                        removed += 1
                except OSError as exc:
                    logger.warning("清理瓦片失败 %s：%s", p, exc)
            _tile_registry.pop((source, z, x, y), None)
    return {"removed": removed, "freed_bytes": freed}


def tile_md5(source: str, z: int, x: int, y: int) -> str:
    """瓦片内容 md5（缓存管理展示用）。"""
    path = _tile_path(source, z, x, y)
    if path.exists():
        return hashlib.md5(path.read_bytes()).hexdigest()
    return ""


def scan_tiles(force: bool = False) -> list[tuple[str, int, int, int, int]]:
    """全部瓦片统计 → [(source, z, x, y, size_bytes)]（默认缓存区域统计/孤儿清理用）。

    增量注册表语义（区域列表每次打开都是 O(n) 内存拷贝，毫秒级、零磁盘扫描）：
    - 写入自动登记（get_tile）、清理自动注销（clear_*），统计始终与「本模块已知磁盘状态」一致；
    - 冷启动首次调用从磁盘装载一次（唯一一次全盘 rglob，通常发生在启动后几秒内的
      首次统计或对账任务，而非用户高峰）；
    - 本模块感知不到的外部改动（手工删目录等）由后台对账纠偏：
      reconcile_scan_cache() 周期强制重扫替换注册表；force=True 即时生效。
    """
    global _tile_registry, _registry_ready
    if not force and _registry_ready:
        with _lock:
            return [(s, z, x, y, size) for (s, z, x, y), size in _tile_registry.items()]
    walked = _walk_tiles_to_dict()
    with _lock:
        _tile_registry = walked
        _registry_ready = True
        return [(s, z, x, y, size) for (s, z, x, y), size in _tile_registry.items()]


def reconcile_scan_cache() -> int:
    """后台对账任务：强制重扫磁盘替换注册表（自愈外部改动；APScheduler 周期调用）。

    扫描在工作线程执行，用户请求路径永不承担全盘扫描成本。
    返回当前注册瓦片数。
    """
    count = len(scan_tiles(force=True))
    logger.debug("瓦片统计注册表已对账：%d 个瓦片", count)
    return count


reconcile_scan_cache.interval_minutes = 10  # 对账周期（分钟）：外部改动最迟 10 分钟被纠正


def clear_orphan_tiles(kept: dict[str, set[tuple[int, int, int]]]) -> dict:
    """清理「不属于任何下载任务」的孤儿瓦片（默认缓存区域手动清理用；kept=各源任务瓦片集合）。

    注意：先在锁外取统计快照再进锁删除（scan_tiles 与本函数共用 _lock，避免重入死锁）。
    删除的瓦片同步从注册表注销。
    """
    removed = 0
    freed = 0
    tiles = scan_tiles()
    with _lock:
        for source, z, x, y, size in tiles:
            if (z, x, y) in kept.get(source, set()):
                continue
            for p in (_tile_path(source, z, x, y), _meta_path(source, z, x, y)):
                try:
                    if p.exists():
                        freed += p.stat().st_size
                        p.unlink()
                        removed += 1
                except OSError as exc:  # noqa: BLE001
                    logger.warning("清理孤儿瓦片失败 %s：%s", p, exc)
            _tile_registry.pop((source, z, x, y), None)
    return {"removed": removed, "freed_bytes": freed}
