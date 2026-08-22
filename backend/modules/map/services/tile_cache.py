"""map 模块：瓦片磁盘缓存与代理抓取（线缆和设备插件方案 §5.4 / §9.2）。

- 磁盘缓存优先命中 → 未命中按源 url_template 抓在线源并落盘（.png + .meta.json）。
- 容量保护：cache.max_size（字节）、download.max_daily（每日抓取上限，进程内计数）。
- 瓦片清理统一入口：clear_tiles()（worker 与清理接口共用，v2.1 ⑭）。
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
_default_ttl = 30 * 24 * 3600  # 瓦片默认有效期 30 天


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
    """代理读取瓦片：缓存优先；未命中/过期 → 抓在线源落盘返回。"""
    ttl = cache_ttl or _default_ttl
    path = _tile_path(source, z, x, y)
    meta = _meta_path(source, z, x, y)
    if path.exists():
        cache_age = time.time() - path.stat().st_mtime
        if cache_age <= ttl:
            return path.read_bytes()
        # 过期：尝试刷新，失败时回退旧缓存（离线可用）
        try:
            data = fetch_remote(source_cfg, z, x, y)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            meta.write_text(json.dumps({"etag": "", "last_modified": "", "fetched_at": int(time.time())}), encoding="utf-8")
            _write_source_meta(source, int(time.time()))
            return data
        except Exception as exc:  # noqa: BLE001
            logger.warning("瓦片刷新失败，回退缓存 %s/%d/%d/%d：%s", source, z, x, y, exc)
            return path.read_bytes()
    if not _daily_ok(int(source_cfg.get("max_daily", 0))):
        raise ValueError("今日瓦片下载配额已用尽")
    data = fetch_remote(source_cfg, z, x, y)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    meta.write_text(json.dumps({"etag": "", "last_modified": "", "fetched_at": int(time.time())}), encoding="utf-8")
    _write_source_meta(source, int(time.time()))
    return data


def clear_tiles(source: str | None = None, before_ts: float | None = None) -> dict:
    """瓦片清理统一入口（下载 worker 与清理接口共用 + 进程锁，v2.1 ⑭）。

    扫描删除 .png + .meta.json；返回 {removed, freed_bytes}。
    """
    root = TILE_CACHE_ROOT / source if source else TILE_CACHE_ROOT
    if not root.exists():
        return {"removed": 0, "freed_bytes": 0}
    removed = 0
    freed = 0
    with _lock:
        for p in list(root.rglob("*.png")) + list(root.rglob("*.meta.json")):
            try:
                if before_ts is not None and p.stat().st_mtime >= before_ts:
                    continue
                size = p.stat().st_size
                p.unlink(missing_ok=True)
                removed += 1
                freed += size
            except OSError as exc:
                logger.warning("清理瓦片失败 %s：%s", p, exc)
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
    return {"removed": removed, "freed_bytes": freed}


def tile_md5(source: str, z: int, x: int, y: int) -> str:
    """瓦片内容 md5（缓存管理展示用）。"""
    path = _tile_path(source, z, x, y)
    if path.exists():
        return hashlib.md5(path.read_bytes()).hexdigest()
    return ""
