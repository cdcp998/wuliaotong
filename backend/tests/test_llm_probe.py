"""LLM 模型可用性探测测试（评审 P1-5）：probe 状态判定、缓存、fallback 跳过。"""
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm as llm_mod
from app.services.llm import (
    _probe_cached_down,
    _probe_provider,
    chat_text_with_fallback,
    invalidate_probe_cache,
    probe_llm_availability,
)

client = TestClient(app)


def test_probe_returns_not_configured_when_no_key():
    """测试库未配置任何 LLM Key：probe 返回 not_configured，且不发网络请求。"""
    from app.db import SessionLocal

    with SessionLocal() as db:
        for name in ("mm_llm", "siliconflow", "deepseek"):
            res = probe_llm_availability(db, name)
            assert res["slot"] == name
            assert res["status"] == "not_configured"
            assert res["configured"] is False


def test_probe_provider_statuses(monkeypatch):
    """_probe_provider 对三种响应判出 ok / degraded / down。"""
    class _Resp:
        def __init__(self, status, data=None):
            self.status_code = status
            self._data = data or {}

        def json(self):
            return self._data

    # ok：200 且模型在列表
    monkeypatch.setattr(
        llm_mod.httpx, "get", lambda *a, **k: _Resp(200, {"data": [{"id": "m1"}, {"id": "m2"}]})
    )
    assert _probe_provider("https://x/v1", "k", "m1")["status"] == "ok"
    # degraded：200 但模型不在列表（可能下线）
    assert _probe_provider("https://x/v1", "k", "gone")["status"] == "degraded"
    # down：HTTP 错误
    monkeypatch.setattr(llm_mod.httpx, "get", lambda *a, **k: _Resp(500))
    assert _probe_provider("https://x/v1", "k", "m1")["status"] == "down"
    # down：网络异常
    def _raise(*a, **k):
        raise RuntimeError("timeout")

    monkeypatch.setattr(llm_mod.httpx, "get", _raise)
    res = _probe_provider("https://x/v1", "k", "m1")
    assert res["status"] == "down" and "timeout" in res["error"]


def test_probe_cache_and_down_skip(monkeypatch):
    """缓存判 down 后 _probe_cached_down=True，chat_text_with_fallback 跳过该模型。"""
    # 直接向内存缓存写入 down 结果（隔离测试库下缓存键按名字隔离）
    from app.core import cache as cache_mod

    llm_mod._PROBE_MEM["mm_llm"] = (llm_mod.time.monotonic(), {"status": "down", "error": "t", "checked_at": 0})
    try:
        assert _probe_cached_down("mm_llm") is True
        # 未缓存/ok 均不跳过
        assert _probe_cached_down("deepseek") is False
    finally:
        llm_mod._PROBE_MEM.clear()

    # fallback 链：主模型缓存 down → 直接跳到备用；两个都未配置 → LLMNotConfigured（不触发真实网络）
    from app.db import SessionLocal

    monkeypatch.setattr(llm_mod.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("不应发起请求")))
    with SessionLocal() as db:
        try:
            chat_text_with_fallback(db, "s", "u", scene="test_probe")
            raise AssertionError("应抛出 LLMNotConfigured")
        except llm_mod.LLMNotConfigured as e:
            assert "已自动跳过" in str(e) or "未配置" in str(e)


def test_health_reports_llm_availability():
    """GET /health 返回 llm_availability 字段（评审 P1-5 入口）。"""
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "llm_availability" in data
    for name in ("mm_llm", "siliconflow", "deepseek"):
        assert name in data["llm_availability"]
        assert data["llm_availability"][name]["status"] in (
            "not_configured", "ok", "degraded", "down", "unknown"
        )
    invalidate_probe_cache()
