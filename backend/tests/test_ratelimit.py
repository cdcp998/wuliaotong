"""接口限流测试：滑动窗口单元测试 + 中间件集成测试（L2 门禁，《后端API设计.md》§11.12）。"""
from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.config import settings
from app.core import ratelimit
from app.core.ratelimit import RateLimiter
from app.main import app

client = TestClient(app)


# ---------- 单元：滑动窗口 ----------

def test_limiter_allows_under_limit() -> None:
    lim = RateLimiter(limit=3, window_seconds=60)
    assert lim.allow("k1") == (True, 0)
    assert lim.allow("k1") == (True, 0)
    assert lim.allow("k1") == (True, 0)


def test_limiter_rejects_over_limit_with_retry_after() -> None:
    lim = RateLimiter(limit=2, window_seconds=60)
    lim.allow("k1")
    lim.allow("k1")
    allowed, retry_after = lim.allow("k1")
    assert allowed is False
    assert retry_after > 0


def test_limiter_window_expiry_resets() -> None:
    lim = RateLimiter(limit=1, window_seconds=0.05)
    assert lim.allow("k1")[0] is True
    assert lim.allow("k1")[0] is False
    time.sleep(0.06)  # 窗口滑过后恢复放行
    assert lim.allow("k1")[0] is True


def test_limiter_keys_independent() -> None:
    lim = RateLimiter(limit=1, window_seconds=60)
    lim.allow("ip-a")
    assert lim.allow("ip-b")[0] is True
    assert lim.allow("ip-b")[0] is False
    assert lim.allow("ip-a")[0] is False


def test_limiter_clear() -> None:
    lim = RateLimiter(limit=1, window_seconds=60)
    lim.allow("k1")
    lim.clear()
    assert lim.allow("k1")[0] is True


# ---------- 集成：中间件 ----------

def test_flood_returns_429_unified_body(monkeypatch) -> None:
    monkeypatch.setattr(ratelimit, "limiter", RateLimiter(limit=3, window_seconds=60))
    for _ in range(3):
        assert client.get("/api/v1/auth/me").status_code != 429  # 正常额度内放行
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 429
    body = r.json()
    assert body["code"] == 4008
    assert "频繁" in body["message"]
    assert body["data"] is None
    assert int(r.headers["retry-after"]) > 0
    assert r.headers["connection"].lower() == "close"


def test_health_exempt_from_limit(monkeypatch) -> None:
    monkeypatch.setattr(ratelimit, "limiter", RateLimiter(limit=2, window_seconds=60))
    client.get("/api/v1/health")
    client.get("/api/v1/health")
    r = client.get("/api/v1/health")  # 已超额度，仍放行
    assert r.status_code == 200
    assert r.json()["code"] == 0


def test_rate_limit_disabled_passes(monkeypatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setattr(ratelimit, "limiter", RateLimiter(limit=1, window_seconds=60))
    assert client.get("/api/v1/auth/me").status_code != 429
    assert client.get("/api/v1/auth/me").status_code != 429


def test_limiter_instance_matches_settings() -> None:
    # 模块级共享实例按 settings 构造（导入时）
    assert ratelimit.limiter.limit == settings.rate_limit_requests
    assert ratelimit.limiter.window_seconds == settings.rate_limit_window_seconds
