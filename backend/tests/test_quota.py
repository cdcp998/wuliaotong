"""AI 服务配额管理测试（系统设置 → OCR 与大模型 → 配额与预警，L2 门禁）。

覆盖：SiliconFlow/DeepSeek/多模态大模型（MM-LLM）配额解析、获取失败优雅降级、
预警邮件（阈值触发一次/去重/恢复后重新触发）、模型-任务映射、接口快照往返。
测试与开发共用数据库：写 sys_config 前先保存原值，结束后恢复/清理。

敏感键保护：测试会向 sys_config 写入假 API Key（sk-*），每个测试在 finally 恢复原值；
模块加载时另存进程级真实值快照，pytest 会话结束再兜底校验一次——
即使测试异常中断（断言失败/崩溃），已保存的 API Key 也不会被假值覆盖。
"""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models.sys import SysConfig
from app.services import quota as q

client = TestClient(app)

SAVED: dict[str, str | None] = {}

# 敏感 API Key 键（进程级快照在 _raw 定义后初始化，见下）
_API_KEY_KEYS = ("llm.siliconflow.api_key", "llm.deepseek.api_key", "llm.mm_llm.api_key")
_FAKE_API_KEYS = {"sk-x", "sk-d", "sk-test", "sk-local", "sk-new-0000", "sk-test-123456", "sk-test-abcdef", "sk-test-xyz789"}


@pytest.fixture(scope="session", autouse=True)
def _protect_saved_api_keys():
    """会话结束兜底：库中残留测试假 Key 时恢复真实值（或删除未配置的键）。"""
    yield
    with SessionLocal() as s:
        changed = False
        for key in _API_KEY_KEYS:
            row = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
            current = row.config_value if row else None
            if current not in _FAKE_API_KEYS:
                continue
            real = _REAL_API_KEYS[key]
            if real is None:
                if row is not None:
                    s.delete(row)
            elif row is None:
                s.add(SysConfig(config_key=key, config_value=real, remark="测试恢复"))
            else:
                row.config_value = real
            changed = True
        if changed:
            s.commit()


def _raw(key: str) -> str | None:
    with SessionLocal() as s:
        row = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
        return row.config_value if row else None


# 进程级快照：任何测试写 api_key 前先记录真实值，恢复时兜底（防中断残留）
_REAL_API_KEYS: dict[str, str | None] = {k: _raw(k) for k in _API_KEY_KEYS}


def _save_originals(keys: list[str]) -> None:
    for k in keys:
        SAVED[k] = _raw(k)


def _restore_all() -> None:
    with SessionLocal() as s:
        for key, value in SAVED.items():
            row = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
            if value is None:
                if row is not None:
                    s.delete(row)
            elif row is None:
                s.add(SysConfig(config_key=key, config_value=value, remark="测试恢复"))
            else:
                row.config_value = value
        s.commit()
    SAVED.clear()


def _set(key: str, value: str) -> None:
    with SessionLocal() as s:
        row = s.scalar(select(SysConfig).where(SysConfig.config_key == key))
        if row is None:
            s.add(SysConfig(config_key=key, config_value=value, remark="测试"))
        else:
            row.config_value = value
        s.commit()


def _expire_refresh() -> None:
    """把最近获取时间设为 25 小时前，使 check_quota_warnings 的间隔判断为「到点」
    （覆盖测试中使用的 1h 与 24h 间隔）。"""
    _set("quota.last_refresh", (datetime.now() - timedelta(hours=25)).isoformat(timespec="seconds"))


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


class FakeResp:
    """最小 httpx.Response 替身（raise_for_status/json）。"""

    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise _FakeHTTPStatusError(self)

    def json(self) -> dict:
        return self._payload


class _FakeHTTPStatusError(Exception):
    response = None  # type: ignore[assignment]


# ============================ 服务商解析 ============================


def test_siliconflow_parse(monkeypatch) -> None:
    monkeypatch.setattr(
        q, "_http_get",
        lambda *a, **k: FakeResp({"code": 20000, "data": {"totalBalance": 12.34, "status": "normal"}}),
    )
    items = q._fetch_siliconflow("https://api.siliconflow.cn/v1", "sk-x")
    assert items[0]["name"] == "账户余额"
    assert items[0]["remaining"] == 12.34 and items[0]["unit"] == "元"
    assert items[0]["status"] == "余额可用"  # 服务商枚举 normal → 可读中文


def test_deepseek_parse(monkeypatch) -> None:
    monkeypatch.setattr(
        q, "_http_get",
        lambda *a, **k: FakeResp({
            "is_available": True,
            "balance_infos": [
                {"currency": "USD", "total_balance": "1.00"},
                {"currency": "CNY", "total_balance": "110.50", "granted_balance": "10.50", "topped_up_balance": "100.00"},
            ],
        }),
    )
    items = q._fetch_deepseek("https://api.deepseek.com", "sk-x")
    assert items[0]["remaining"] == 110.5 and items[0]["unit"] == "元"  # 优先取 CNY


def test_mmllm_ark_parse(monkeypatch) -> None:
    """多模态大模型指向火山方舟时的资源配额解析。"""
    monkeypatch.setattr(
        q, "_http_get",
        lambda *a, **k: FakeResp({
            "quota_list": [
                {"id": "q1", "name": "资源包A", "model_reference": {"type": "model", "id": "mm-llm-x"},
                 "status": "正常", "total": 1000000, "used": 300000},
            ]
        }),
    )
    items = q._fetch_ark("https://ark.cn-beijing.volces.com/api/v3", "sk-x")
    assert items[0]["name"] == "资源包A"
    assert items[0]["remaining"] == 700000  # total - used 兜底计算
    assert items[0]["status"] == "正常"


def test_fetch_error_graceful(monkeypatch) -> None:
    """网络/鉴权失败 → ok=False + 可读错误，不抛异常。"""
    import httpx

    def _boom(*a, **k):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(q, "_http_get", _boom)
    _save_originals(["llm.siliconflow.api_key", "llm.siliconflow.base_url"])
    try:
        _set("llm.siliconflow.api_key", "sk-test")
        _set("llm.siliconflow.base_url", "https://api.siliconflow.cn/v1")
        with SessionLocal() as db:
            payload = q.fetch_provider_quota(db, "siliconflow")
        assert payload["ok"] is False
        assert "请求失败" in payload["error"]
    finally:
        _restore_all()


def test_fetch_unknown_provider() -> None:
    with SessionLocal() as db:
        payload = q.fetch_provider_quota(db, "nope")
    assert payload["ok"] is False and "未知服务商" in payload["error"]


# ============================ 预警邮件 ============================


def test_quota_warning_email_send_once_then_recover(monkeypatch) -> None:
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(q, "send_mail", lambda db, to, subject, content: sent.append((to, subject, content)))
    below = {"ok": True, "fetched_at": "2026-08-07 10:00:00", "items": [{"name": "余额", "value": 10, "unit": "元", "remaining": 10}]}
    above = {"ok": True, "fetched_at": "2026-08-07 11:00:00", "items": [{"name": "余额", "value": 100, "unit": "元", "remaining": 100}]}

    def _fake_fetch(db, provider: str):
        return above if provider == "deepseek" else below  # 仅 siliconflow 配阈值，deepseek 无阈值不参与

    monkeypatch.setattr(q, "fetch_provider_quota", _fake_fetch)
    _save_originals([
        "quota.warning.enabled", "quota.warning.recipients",
        "quota.warning.threshold.siliconflow", "quota.warning.threshold.deepseek",
        "quota.warning.threshold.mm_llm", "quota.warning.notified.siliconflow", "quota.snapshot",
        "llm.siliconflow.enabled", "llm.siliconflow.api_key",
        "quota.last_refresh", "quota.refresh.interval_minutes",
    ])
    try:
        _set("quota.warning.enabled", "1")
        _set("quota.warning.recipients", "a@x.com, b@y.com")
        _set("quota.warning.threshold.siliconflow", "50")
        _set("quota.warning.threshold.deepseek", "")
        _set("quota.warning.threshold.mm_llm", "")
        _set("quota.refresh.interval_minutes", "60")
        _set("quota.warning.notified.siliconflow", "")
        _set("llm.siliconflow.enabled", "1")  # 保证定时刷新会查询 siliconflow（走 monkeypatch 的 fetch）
        _set("llm.siliconflow.api_key", "sk-x")

        # 第一次检查：低于阈值 → 发 2 封（两个收件人）
        _expire_refresh()
        r1 = q.check_quota_warnings()
        assert r1["emails"] == 2 and r1["providers"] == ["siliconflow"]
        assert len(sent) == 2
        assert "视觉模型" in sent[0][2]  # 正文包含服务商中文名与配置的模型名（标签已中文化）
        assert "配额预警" in sent[0][1]

        # 第二次检查：仍低于阈值但已通知过 → 不再发
        _expire_refresh()
        r2 = q.check_quota_warnings()
        assert r2["emails"] == 0 and len(sent) == 2

        # 恢复：高于阈值 → 清除告警标记，不发邮件
        monkeypatch.setattr(q, "fetch_provider_quota", lambda db, provider: above)
        _expire_refresh()
        r3 = q.check_quota_warnings()
        assert r3["emails"] == 0 and len(sent) == 2

        # 再次跌破 → 重新通知（标记已清除）
        monkeypatch.setattr(q, "fetch_provider_quota", _fake_fetch)
        _expire_refresh()
        r4 = q.check_quota_warnings()
        assert r4["emails"] == 2 and len(sent) == 4
    finally:
        _restore_all()


def test_quota_warning_disabled_no_email(monkeypatch) -> None:
    monkeypatch.setattr(q, "send_mail", lambda *a, **k: (_ for _ in ()).throw(AssertionError("不应发邮件")))
    _save_originals(["quota.warning.enabled", "quota.warning.recipients", "quota.last_refresh"])
    try:
        _set("quota.warning.enabled", "0")
        _set("quota.warning.recipients", "a@x.com")
        _expire_refresh()  # 保证通过间隔判断，走到 enabled 检查
        assert q.check_quota_warnings()["reason"] == "disabled"
    finally:
        _restore_all()


def test_refresh_quota_snapshots_auto(monkeypatch) -> None:
    """定期自动获取：只查询已启用且配置了 API Key 的服务商；未启用/未配置的跳过并清除旧快照。"""
    ok_sf = {"provider": "siliconflow", "ok": True, "fetched_at": "t", "items": [{"name": "余额", "value": 88, "unit": "元", "remaining": 88}]}
    called: list[str] = []

    def _fake(db, provider: str):
        called.append(provider)
        return ok_sf

    monkeypatch.setattr(q, "fetch_provider_quota", _fake)
    _save_originals([
        "quota.snapshot",
        "llm.siliconflow.enabled", "llm.siliconflow.api_key",
        "llm.deepseek.enabled", "llm.deepseek.api_key",
        "llm.mm_llm.enabled", "llm.mm_llm.api_key",
        "quota.last_refresh",
    ])
    try:
        # deepseek 未启用、mm_llm 未配置 Key → 均不查询；预先写入 deepseek 旧快照验证被清除
        _set("llm.siliconflow.enabled", "1")
        _set("llm.siliconflow.api_key", "sk-x")
        _set("llm.deepseek.enabled", "0")
        _set("llm.deepseek.api_key", "sk-d")
        _set("llm.mm_llm.enabled", "1")
        _set("llm.mm_llm.api_key", "")
        with SessionLocal() as db:
            q.save_quota_snapshot(db, "deepseek", {"provider": "deepseek", "ok": True, "fetched_at": "old", "items": []})

        result = q.refresh_quota_snapshots()
        assert result["checked"] == 1 and result["ok"] == 1
        assert result["skipped"] == ["deepseek", "mm_llm"]
        assert called == ["siliconflow"]  # 只查询了已启用且配置 Key 的服务商

        with SessionLocal() as db:
            snap = q.get_quota_snapshot(db)
        assert snap["siliconflow"]["ok"] is True and snap["siliconflow"]["items"][0]["remaining"] == 88
        assert "deepseek" not in snap and "mm_llm" not in snap  # 旧快照已清除，无 401 失败记录

        # 预警未启用时，定时任务同样刷新快照
        _set("quota.warning.enabled", "0")
        _expire_refresh()
        assert q.check_quota_warnings()["reason"] == "disabled"
        with SessionLocal() as db:
            snap2 = q.get_quota_snapshot(db)
        assert snap2["siliconflow"]["ok"] is True
    finally:
        _restore_all()


def test_quota_refresh_interval_respected(monkeypatch) -> None:
    """自定义获取间隔：未到间隔 → 不刷新不检查不发邮件；到间隔 → 正常执行。"""
    sent: list[str] = []
    called: list[str] = []
    monkeypatch.setattr(q, "send_mail", lambda db, to, subject, content: sent.append(to))
    ok_sf = {"ok": True, "fetched_at": "t", "items": [{"name": "余额", "value": 10, "unit": "元", "remaining": 10}]}
    monkeypatch.setattr(q, "fetch_provider_quota", lambda db, provider: (called.append(provider), ok_sf)[1])
    _save_originals([
        "quota.warning.enabled", "quota.warning.recipients", "quota.warning.threshold.siliconflow",
        "quota.warning.threshold.deepseek", "quota.warning.threshold.mm_llm",
        "quota.refresh.interval_minutes", "quota.refresh.interval_hours",
        "quota.last_refresh", "quota.snapshot",
        "quota.warning.notified.siliconflow",
        "llm.siliconflow.enabled", "llm.siliconflow.api_key",
    ])
    try:
        _set("quota.warning.enabled", "1")
        _set("quota.warning.recipients", "a@x.com")
        _set("quota.warning.threshold.siliconflow", "50")
        _set("quota.warning.threshold.deepseek", "")  # 隔离开发库真实阈值：deepseek 不得误入预警
        _set("quota.warning.threshold.mm_llm", "")
        _set("quota.warning.notified.siliconflow", "")
        _set("quota.refresh.interval_minutes", "1440")  # 自定义间隔：24 小时 = 1440 分钟
        _set("llm.siliconflow.enabled", "1")
        _set("llm.siliconflow.api_key", "sk-x")
        _set("quota.last_refresh", datetime.now().isoformat(timespec="seconds"))  # 刚获取过

        # 未到间隔 → 跳过（不查询、不发邮件）
        r1 = q.check_quota_warnings()
        assert r1["reason"] == "not_due" and r1["interval_minutes"] == 1440.0
        assert called == [] and sent == []

        # 超过间隔 → 正常执行（查询 + 低于阈值发邮件）
        _expire_refresh()
        r2 = q.check_quota_warnings()
        assert r2["emails"] == 1 and r2["providers"] == ["siliconflow"]
        assert "siliconflow" in called and "mm_llm" not in called  # 已启用配置的均会查询，未配置的跳过
        assert len(sent) == 1

        # 间隔配置非法/为空 → 回退默认 60 分钟
        _set("quota.refresh.interval_minutes", "")
        _expire_refresh()
        with SessionLocal() as db:
            assert q.refresh_interval_minutes(db) == 60.0

        # 旧版本小时配置（quota.refresh.interval_hours）自动迁移：×60 并删除旧键
        _set("quota.refresh.interval_minutes", "")
        _set("quota.refresh.interval_hours", "2")
        with SessionLocal() as db:
            assert q.refresh_interval_minutes(db) == 120.0
            assert db.scalar(select(SysConfig).where(SysConfig.config_key == "quota.refresh.interval_hours")) is None
            assert db.scalar(select(SysConfig).where(SysConfig.config_key == "quota.refresh.interval_minutes")).config_value == "120.0"
    finally:
        _restore_all()


def test_fetch_skipped_when_disabled_or_no_key(monkeypatch) -> None:
    """手动获取：未启用 / 未配置 Key 时不查询服务商（不产生网络请求与失败记录）。"""
    def _boom(*a, **k):
        raise AssertionError("未启用/未配置 Key 时不应发起服务商请求")

    monkeypatch.setattr(q, "_http_get", _boom)
    _save_originals(["llm.siliconflow.enabled", "llm.siliconflow.api_key", "llm.deepseek.enabled", "llm.deepseek.api_key"])
    try:
        _set("llm.siliconflow.enabled", "0")
        _set("llm.siliconflow.api_key", "sk-x")
        with SessionLocal() as db:
            p1 = q.fetch_provider_quota(db, "siliconflow")
        assert p1["ok"] is False and "未启用" in p1["error"]

        _set("llm.deepseek.enabled", "1")
        _set("llm.deepseek.api_key", "")
        with SessionLocal() as db:
            p2 = q.fetch_provider_quota(db, "deepseek")
        assert p2["ok"] is False and "API Key" in p2["error"]
    finally:
        _restore_all()


def test_fetch_custom_provider_no_quota_api(monkeypatch) -> None:
    """自选/自建 OpenAI 兼容服务商（非官方域名）：不发起配额请求，返回兼容性说明。"""
    def _boom(*a, **k):
        raise AssertionError("自建服务商不应发起配额请求")

    monkeypatch.setattr(q, "_http_get", _boom)
    _save_originals(["llm.siliconflow.enabled", "llm.siliconflow.api_key", "llm.siliconflow.base_url"])
    try:
        _set("llm.siliconflow.enabled", "1")
        _set("llm.siliconflow.api_key", "sk-local")
        # 自建内网 vLLM / 第三方网关（OpenAI 兼容，但无余额接口）
        _set("llm.siliconflow.base_url", "http://192.168.1.10:8000/v1")
        with SessionLocal() as db:
            payload = q.fetch_provider_quota(db, "siliconflow")
        assert payload["ok"] is False
        assert "不提供标准的余额/配额查询接口" in payload["error"]
        assert "OpenAI 兼容" in payload["error"]  # 明确说明兼容性标准
    finally:
        _restore_all()


# ============================ 模型-任务映射 ============================


def test_model_scenes() -> None:
    _save_originals(["llm.deepseek.enabled"])
    try:
        _set("llm.deepseek.enabled", "0")
        with SessionLocal() as db:
            models = q.get_model_scenes(db)
        by_name = {m["name"]: m for m in models}
        assert set(by_name) == {"siliconflow", "deepseek", "mm_llm"}
        assert by_name["deepseek"]["enabled"] is False
        assert by_name["siliconflow"]["enabled"] is True
        scenes = {s["scene"] for s in by_name["deepseek"]["scenes"]}
        assert {"ocr_correct", "classify_items", "structured"} <= scenes
        # 每个任务都有中文名与说明
        for m in models:
            for s in m["scenes"]:
                assert s["label"] and s["desc"] and s["role"] in ("主用", "备用")
    finally:
        _restore_all()


# ============================ 接口往返 ============================


def test_quota_api_fetch_and_snapshot(monkeypatch) -> None:
    _login_admin()
    fake_payload = {
        "provider": "siliconflow", "ok": True, "fetched_at": "2026-08-07 10:00:00",
        "items": [{"name": "账户余额", "value": 66.0, "unit": "元", "remaining": 66.0, "status": "ACTIVE"}],
    }
    monkeypatch.setattr(q, "fetch_provider_quota", lambda db, provider: fake_payload)
    _save_originals(["quota.snapshot", "quota.last_refresh"])
    try:
        r = client.post("/api/v1/llm/quota/siliconflow")
        assert r.status_code == 200 and r.json()["code"] == 0, r.text
        assert r.json()["data"]["ok"] is True and r.json()["data"]["items"][0]["remaining"] == 66.0
        r2 = client.get("/api/v1/llm/quota")
        data = r2.json()["data"]["providers"]
        assert data["siliconflow"]["items"][0]["remaining"] == 66.0
        # 未知服务商 → 4006
        r3 = client.post("/api/v1/llm/quota/nope")
        assert r3.json()["code"] != 0
    finally:
        _restore_all()
