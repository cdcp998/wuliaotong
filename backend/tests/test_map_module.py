"""map 模块单元测试（纯逻辑，不写业务表）：

- 下载 worker 自适应并发 AIMD 调整边界；
- TileQuotaExceeded 异常类型（worker 据此免烧重试次数）；
- 瓦片统计**增量注册表**语义：写入自动登记 / 清理自动注销 / 对账自愈外部改动
  （隔离临时目录，不触碰真实 tile_cache）。
"""
from __future__ import annotations

import importlib
import time

import pytest


# ============================ 自适应并发（AIMD） ============================

def _adjust(conc: int, ok: int, fail: int) -> tuple[int, float]:
    from app.modules.map.services import download_worker as dw

    old = dw._concurrency
    try:
        dw._concurrency = conc
        return dw._adjust_concurrency(ok, fail)
    finally:
        dw._concurrency = old


def test_adjust_increase_on_all_success():
    assert _adjust(4, 20, 0) == (5, 0.0)


def test_adjust_cap_at_max():
    assert _adjust(8, 40, 0)[0] == 8


def test_adjust_halve_on_any_failure():
    assert _adjust(8, 30, 1)[0] == 4


def test_adjust_floor_at_min():
    assert _adjust(2, 0, 5)[0] == 2


def test_adjust_cooldown_on_majority_failure():
    new_conc, cooldown = _adjust(4, 1, 9)
    assert new_conc == 2
    assert cooldown > 0.0


def test_adjust_no_cooldown_on_minority_failure():
    _, cooldown = _adjust(4, 9, 1)
    assert cooldown == 0.0


def test_adjust_steady_when_no_work():
    assert _adjust(6, 0, 0) == (6, 0.0)


# ============================ 配额异常语义 ============================

def test_quota_exceeded_is_value_error():
    """兼容旧 except ValueError 兜底路径（如瓦片代理接口）。"""
    from app.modules.map.services.tile_cache import TileQuotaExceeded

    assert issubclass(TileQuotaExceeded, ValueError)
    with pytest.raises(ValueError):
        raise TileQuotaExceeded("今日瓦片下载配额已用尽")


# ============================ 增量统计注册表 ============================

@pytest.fixture()
def isolated_tile_cache(tmp_path, monkeypatch):
    """把 TILE_CACHE_ROOT 重载绑定到临时目录（注册表随之清零）；用后恢复原模块状态。"""
    monkeypatch.setenv("CABLE_TILE_CACHE_DIR", str(tmp_path))
    from app.modules.map.services import tile_cache as tc

    importlib.reload(tc)
    yield tc, tmp_path
    monkeypatch.undo()
    importlib.reload(tc)


def _fake_fetch(tc, payload: bytes):
    tc.fetch_remote = lambda cfg, z, x, y: payload  # 直接替换模块属性（fixture 结束随 reload 还原）


@pytest.fixture()
def warmed_tile_cache(isolated_tile_cache):
    """基线已装载（模拟启动时后台对账任务先行 warm）的事件模型环境。"""
    tc, root = isolated_tile_cache
    assert tc.scan_tiles() == []  # 空目录基线装载，_registry_ready=True
    yield tc, root


def test_get_tile_registers_incrementally(warmed_tile_cache):
    tc, root = warmed_tile_cache
    _fake_fetch(tc, b"abc")
    cfg = {"url_template": "https://upstream/{z}/{x}/{y}", "max_daily": 0}
    data = tc.get_tile(cfg, "esri", 10, 1, 2)
    assert data == b"abc"
    assert (root / "esri" / "10" / "1" / "2.png").exists()
    # 写入即登记：无需 force、无 TTL 等待，统计立即可见
    assert tc.scan_tiles() == [("esri", 10, 1, 2, 3)]


def test_ttl_refresh_updates_registered_size(warmed_tile_cache):
    tc, root = warmed_tile_cache
    _fake_fetch(tc, b"abc")
    cfg = {"url_template": "https://upstream/{z}/{x}/{y}", "max_daily": 0}
    tc.get_tile(cfg, "esri", 10, 1, 2)
    _fake_fetch(tc, b"xyzw")  # 上游内容变化（变大）
    time.sleep(0.02)  # 确保 mtime 前移，cache_ttl=0 触发刷新路径
    tc.get_tile(cfg, "esri", 10, 1, 2, cache_ttl=0)
    assert tc.scan_tiles() == [("esri", 10, 1, 2, 4)]  # 注册表同步更新尺寸


def test_clear_tiles_for_unregisters_immediately(warmed_tile_cache):
    tc, root = warmed_tile_cache
    _fake_fetch(tc, b"abc")
    cfg = {"url_template": "https://upstream/{z}/{x}/{y}", "max_daily": 0}
    tc.get_tile(cfg, "esri", 10, 1, 2)
    result = tc.clear_tiles_for("esri", [(10, 1, 2)])
    assert result["removed"] >= 1
    assert tc.scan_tiles() == []  # 清理即注销，统计立即归零（无失效重扫成本）


def test_clear_orphan_tiles_unregisters(warmed_tile_cache):
    tc, root = warmed_tile_cache
    _fake_fetch(tc, b"abc")
    cfg = {"url_template": "https://upstream/{z}/{x}/{y}", "max_daily": 0}
    tc.get_tile(cfg, "esri", 10, 1, 2)
    result = tc.clear_orphan_tiles({})  # kept 为空 → 该瓦片视为孤儿删除（png + meta 各计一次）
    assert result["removed"] == 2
    assert tc.scan_tiles() == []


def test_reconcile_heals_external_deletion(warmed_tile_cache):
    """事件驱动模型感知不到模块外的磁盘改动；后台对账强制重扫纠偏。"""
    tc, root = warmed_tile_cache
    _fake_fetch(tc, b"abc")
    cfg = {"url_template": "https://upstream/{z}/{x}/{y}", "max_daily": 0}
    tc.get_tile(cfg, "esri", 10, 1, 2)
    png = root / "esri" / "10" / "1" / "2.png"
    png.unlink()  # 模拟外部改动（手工删文件）
    assert len(tc.scan_tiles()) == 1  # 注册表不知道，统计仍含该瓦片
    count = tc.reconcile_scan_cache()
    assert count == 0
    assert tc.scan_tiles() == []  # 对账后纠正


def test_cold_start_loads_from_disk_once(isolated_tile_cache):
    """进程冷启动：首次统计从磁盘装载既有瓦片，此后增量维护。"""
    tc, root = isolated_tile_cache
    png = root / "esri" / "3" / "0" / "0.png"
    png.parent.mkdir(parents=True)
    png.write_bytes(b"12345")
    assert not tc._registry_ready
    assert tc.scan_tiles() == [("esri", 3, 0, 0, 5)]
    assert tc._registry_ready
