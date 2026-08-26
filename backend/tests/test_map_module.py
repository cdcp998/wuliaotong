"""map 模块单元测试（纯逻辑，不写业务表）：

- 下载 worker 自适应并发 AIMD 调整边界；
- TileQuotaExceeded 异常类型（worker 据此免烧重试次数）；
- 瓦片统计**增量注册表**语义：写入自动登记 / 清理自动注销 / 对账自愈外部改动
  （隔离临时目录，不触碰真实 tile_cache）；
- 同瓦片 singleflight：并发未命中去重 / leader 失败等待者自愈；
- 进程内配置 TTL 缓存：命中/深拷贝/失效语义；
- tile_proxy 无 db 参数回归：配置经短会话读取，慢 IO 阶段无打开会话。
"""
from __future__ import annotations

import importlib
import threading
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


# ============================ 同瓦片 singleflight ============================

def test_singleflight_dedupes_concurrent_misses(isolated_tile_cache):
    """双线程并发请求同一未缓存瓦片：上游只被抓取 1 次，双方都拿到数据（总超时防挂死）。"""
    tc, _root = isolated_tile_cache
    calls: list[int] = []
    gate = threading.Event()
    entered = threading.Event()

    def gated_fetch(cfg, z, x, y):
        calls.append(1)
        entered.set()
        assert gate.wait(timeout=10), "测试门未放行"
        return b"same-tile"

    tc.fetch_remote = gated_fetch
    cfg = {"url_template": "https://upstream/{z}/{x}/{y}", "max_daily": 0}
    results: list[bytes] = []

    def worker():
        results.append(tc.get_tile(cfg, "esri", 9, 0, 0))

    t1 = threading.Thread(target=worker)
    t1.start()
    assert entered.wait(5)  # leader 已进入抓取段（阻塞在 gate 上）
    t2 = threading.Thread(target=worker)
    t2.start()
    deadline = time.time() + 5  # 确认 t2 已登记为等待者（而非竞速成第二个 leader）
    while tc._sf_waiters(("esri", 9, 0, 0)) < 1 and time.time() < deadline:
        time.sleep(0.01)
    assert tc._sf_waiters(("esri", 9, 0, 0)) >= 1
    gate.set()  # 放行 leader
    t1.join(10)
    t2.join(10)
    assert not t1.is_alive() and not t2.is_alive()
    assert len(calls) == 1  # 上游只被调用 1 次
    assert results == [b"same-tile", b"same-tile"]


def test_singleflight_follower_retries_after_leader_failure(isolated_tile_cache):
    """leader 抓取失败 → 等待者重查磁盘未命中后自行按普通未命中流程重试成功。"""
    tc, root = isolated_tile_cache
    state = {"n": 0}
    lk = threading.Lock()
    first_entered = threading.Event()
    release_first = threading.Event()

    def flaky_fetch(cfg, z, x, y):
        with lk:
            state["n"] += 1
            n = state["n"]
        if n == 1:
            first_entered.set()
            assert release_first.wait(timeout=10)
            raise RuntimeError("upstream boom")
        return b"recovered"

    tc.fetch_remote = flaky_fetch
    cfg = {"url_template": "https://upstream/{z}/{x}/{y}", "max_daily": 0}
    out: dict = {}

    def leader():
        try:
            out["leader"] = tc.get_tile(cfg, "esri", 8, 1, 1)
        except Exception as exc:  # noqa: BLE001
            out["leader_err"] = exc

    def follower():
        try:
            out["follower"] = tc.get_tile(cfg, "esri", 8, 1, 1)
        except Exception as exc:  # noqa: BLE001
            out["follower_err"] = exc

    t1 = threading.Thread(target=leader)
    t1.start()
    assert first_entered.wait(5)
    t2 = threading.Thread(target=follower)
    t2.start()
    deadline = time.time() + 5
    while tc._sf_waiters(("esri", 8, 1, 1)) < 1 and time.time() < deadline:
        time.sleep(0.01)
    release_first.set()
    t1.join(10)
    t2.join(10)
    assert not t1.is_alive() and not t2.is_alive()
    assert isinstance(out.get("leader_err"), RuntimeError)  # leader 失败原样抛出
    assert out.get("follower") == b"recovered"  # 等待者自行重试成功
    assert (root / "esri" / "8" / "1" / "1.png").read_bytes() == b"recovered"  # 最终落盘
    assert state["n"] == 2  # 上游共被调用 2 次（leader 失败 + follower 重试）


# ============================ 进程内配置 TTL 缓存 ============================

def test_config_ttl_cache_hit_deepcopy_and_invalidate():
    """假 loader 注入可测包装器：TTL 内只加载一次；返回值互为深拷贝；失效后重新加载。"""
    from app.modules.map.services import config_store as cs

    calls: list[int] = []
    now = [100.0]

    cache = cs._TtlCache(ttl=5.0, clock=lambda: now[0])

    def loader() -> dict:
        calls.append(1)
        return {"map_sources": {"esri": {"enabled": True}}, "n": len(calls)}

    a = cache.get(loader)
    b = cache.get(loader)
    assert len(calls) == 1  # TTL 内只调 loader 一次
    assert a == b and a is not b  # 返回对象互为深拷贝
    a["map_sources"]["esri"]["enabled"] = False  # 模拟调用方原地修改
    a["n"] = 999
    c = cache.get(loader)
    assert c == {"map_sources": {"esri": {"enabled": True}}, "n": 1}  # 缓存未被污染
    now[0] += 6.0  # 越过 TTL → 重新加载
    d = cache.get(loader)
    assert len(calls) == 2 and d["n"] == 2
    cache.invalidate()  # 显式失效（save_config 写入路径语义）→ 立即重新加载
    e = cache.get(loader)
    assert len(calls) == 3 and e["n"] == 3


# ============================ tile_proxy 无 db 参数回归 ============================

def test_tile_proxy_reads_config_via_short_session(monkeypatch):
    """tile_proxy 不再声明 db 依赖；get_tile 收到的配置来自**已关闭**的短会话读取。"""
    from app.modules.map import api as map_api

    events: list[str] = []
    captured: dict = {}

    class FakeSession:
        def __enter__(self):
            events.append("open")
            return self

        def __exit__(self, *args):
            events.append("close")
            return False

    class FakeSessionLocal:
        def __call__(self):
            return FakeSession()

    fake_cfg = {"map_sources": {"esri": {"enabled": True, "url_template": "u/{z}/{x}/{y}"}}}

    def fake_effective_config(db):
        captured["db_is_fake_session"] = isinstance(db, FakeSession)
        return fake_cfg

    def fake_get_tile(src_cfg, source, z, x, y, cache_ttl=None):
        events.append("get_tile")
        captured["src_cfg"] = src_cfg
        return b"\x89PNG-fake"

    monkeypatch.setattr(map_api, "SessionLocal", FakeSessionLocal())
    monkeypatch.setattr(map_api.config_store, "effective_config", fake_effective_config)
    monkeypatch.setattr(map_api.tile_cache, "get_tile", fake_get_tile)

    resp = map_api.tile_proxy("esri", 10, 1, 2)

    assert resp.body == b"\x89PNG-fake"
    assert resp.media_type == "image/png"
    assert captured["db_is_fake_session"] is True
    assert captured["src_cfg"]["enabled"] is True  # 配置来自短会话读取
    # 关键时序：会话在 get_tile（慢 IO）之前已关闭——慢 IO 阶段无打开的 SQLAlchemy 会话
    assert events == ["open", "close", "get_tile"]
