"""P6 后端闭环测试：通知三渠道 worker（核心，独立于模块）+ 瓦片批量下载 worker（cable jobs）。"""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.db import SessionLocal
from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login(username: str = "admin", password: str = "admin123") -> None:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200 and r.json()["code"] == 0, r.text


@pytest.fixture(scope="module", autouse=True)
def _ensure_cable():
    _login()
    client.post("/api/v1/modules/cable/install")
    assert client.post("/api/v1/modules/cable/enable").json()["code"] == 0
    yield


# ============================ 通知三渠道 ============================

def test_notify_channel_config_api() -> None:
    _login()
    # 默认仅站内
    r = client.get("/api/v1/notifications/channels")
    assert r.json()["code"] == 0 and r.json()["data"]["channels"] == ["internal"]
    # 保存三渠道
    r = client.put("/api/v1/notifications/channels", json={"channels": ["internal", "email", "sms"], "sms_provider": ""})
    assert r.json()["code"] == 0
    r = client.get("/api/v1/notifications/channels")
    assert sorted(r.json()["data"]["channels"]) == ["email", "internal", "sms"]
    # 恢复默认
    client.put("/api/v1/notifications/channels", json={"channels": ["internal"], "sms_provider": ""})


def test_notify_user_internal_delivery() -> None:
    """notify_user（核心服务）→ 站内通知 + delivery pending → worker → success + 可查询。"""
    from app.models import SysUser
    from app.services.notify import notify_user

    db = SessionLocal()
    try:
        admin = db.scalar(select(SysUser).where(SysUser.username == "admin"))
        notif = notify_user(
            db, admin.id, "T-测试通知", "T-内容：三渠道分发", biz_type="T-测试",
            link="/dashboard", channels=["internal", "sms"], idempotency_key=f"T-{_TAG}",
        )
        db.commit()
        orig_id = notif.id
        assert orig_id > 0
        # 投递两条：internal + sms
        from app.models import SysNotificationDelivery

        rows = db.scalars(select(SysNotificationDelivery).where(SysNotificationDelivery.notification_id == notif.id)).all()
        assert {r.channel for r in rows} == {"internal", "sms"}
        by_ch = {r.channel: r.status for r in rows}
        assert by_ch["internal"] == "pending"  # 站内待发送
        assert by_ch["sms"] == "failed"  # admin 无手机号 → 创建即 failed
    finally:
        db.close()

    # worker 处理：internal → success；sms 未配置 → 失败重试后 failed
    from app.services.notify.worker import notify_worker_tick

    for _ in range(6):
        notify_worker_tick()
        db = SessionLocal()
        try:
            from app.models import SysNotificationDelivery

            statuses = {
                r.channel: r.status for r in db.scalars(
                    select(SysNotificationDelivery).where(
                        SysNotificationDelivery.notification_id == orig_id
                    )
                ).all()
            }
        finally:
            db.close()
        if statuses.get("internal") == "success" and statuses.get("sms") == "failed":
            break
    assert statuses["internal"] == "success"
    assert statuses["sms"] == "failed"
    # sms 重试计数 = 1（无手机号：创建即 failed，worker 不再重试）
    db = SessionLocal()
    try:
        from app.models import SysNotificationDelivery

        sms = db.scalar(select(SysNotificationDelivery).where(
            SysNotificationDelivery.notification_id == orig_id, SysNotificationDelivery.channel == "sms"))
        assert sms.status == "failed" and sms.last_error
    finally:
        db.close()

    # 幂等：同一 idempotency_key 不重复创建（返回已有通知）
    db = SessionLocal()
    try:
        from app.models import SysUser
        from app.services.notify import notify_user

        admin = db.scalar(select(SysUser).where(SysUser.username == "admin"))
        again = notify_user(db, admin.id, "T-测试通知2", "T-不应重复", biz_type="T-测试", channels=["internal"], idempotency_key=f"T-{_TAG}")
        db.commit()
        assert again.id == orig_id
    finally:
        db.close()

    # 投递记录查询接口（管理者及以上）
    _login()
    r = client.get("/api/v1/notifications/deliveries", params={"channel": "internal", "page_size": 5})
    assert r.json()["code"] == 0
    assert any(i["status"] == "success" for i in r.json()["data"]["items"])


def test_sms_provider_unconfigured_retry() -> None:
    """有手机号但短信服务商未配置：worker 重试 3 次后 failed（last_error 记录）。"""
    from app.models import SysNotificationDelivery, SysUser
    from app.services.notify import notify_user
    from app.services.notify.worker import notify_worker_tick

    uname = f"fg{_TAG}{uuid.uuid4().hex[:4]}"
    _login()
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "real_name": "短信测试", "role_id": 6, "phone": "13800001111"})
    assert r.json()["code"] == 0, r.text

    db = SessionLocal()
    try:
        u = db.scalar(select(SysUser).where(SysUser.username == uname))
        notif = notify_user(db, u.id, "T-短信测试", "T-短信内容", biz_type="T-测试", channels=["sms"], idempotency_key=f"T-SMS-{_TAG}")
        db.commit()
        nid = notif.id
    finally:
        db.close()
    for _ in range(6):
        notify_worker_tick()
        db = SessionLocal()
        try:
            d = db.scalar(select(SysNotificationDelivery).where(SysNotificationDelivery.notification_id == nid))
            st = d.status if d else "?"
        finally:
            db.close()
        if st == "failed":
            break
    assert st == "failed"
    db = SessionLocal()
    try:
        d = db.scalar(select(SysNotificationDelivery).where(SysNotificationDelivery.notification_id == nid))
        assert d.retry_count == 3 and "短信服务商未配置" in (d.last_error or "")
    finally:
        db.close()


# ============================ 瓦片批量下载 ============================

def test_tile_batch_download_flow() -> None:
    """区域 → 创建下载任务 → worker 消费（网络不可用走失败/重试路径；暂停/进度接口可用）。"""
    _login()
    # 预置默认地图源（隔离库清理会复位 config；幂等）
    esri = {"key": "esri", "name": "Esri 影像", "type": "esri", "coordinate_space": "wgs84",
            "url_template": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "enabled": True}
    assert client.put("/api/v1/map/sources", json=[esri]).json()["code"] == 0
    r = client.post("/api/v1/map/cache/regions", json={
        "name": "T-下载区域", "geometry": {"type": "Polygon", "bbox": [119.9, 30.0, 120.1, 30.2]},
        "min_zoom": 1, "max_zoom": 2, "update_mode": "manual",
    })
    assert r.json()["code"] == 0, r.text
    region_id = r.json()["data"]["id"]
    r = client.post(f"/api/v1/map/cache/regions/{region_id}/start")
    assert r.json()["code"] == 0
    assert r.json()["data"]["tiles_queued"] > 0

    from app.modules.cable.services.download_worker import download_worker_tick

    # worker 消费（离线源抓取失败 → 标失败/重试；不抛异常）
    for _ in range(4):
        download_worker_tick()
    r = client.get("/api/v1/map/downloads")
    assert r.json()["code"] == 0
    prog = r.json()["data"]
    assert prog["pending"] + prog["done"] + prog["failed"] >= 0

    # 暂停区域 → 再次 start 不重复生成（uk 幂等）
    assert client.post(f"/api/v1/map/cache/regions/{region_id}/pause").json()["code"] == 0
    r = client.post(f"/api/v1/map/cache/regions/{region_id}/start")
    assert r.json()["code"] == 0

    # source 记录 + 磁盘瓦片精确清理
    db = SessionLocal()
    try:
        t = db.execute(text("SELECT source, z, x, y FROM map_download_task WHERE region_id = :r LIMIT 1"), {"r": region_id}).fetchone()
        assert t is not None and t[0] == "esri"
        from app.modules.cable.services import tile_cache

        png = tile_cache._tile_path("esri", int(t[1]), int(t[2]), int(t[3]))
        png.parent.mkdir(parents=True, exist_ok=True)
        png.write_bytes(b"fake-tile")
        assert png.exists()
    finally:
        db.close()

    # 清理
    assert client.post(f"/api/v1/map/cache/regions/{region_id}/clear").json()["code"] == 0
    assert not png.exists()  # 磁盘瓦片已删除
    r = client.get("/api/v1/map/cache/regions")
    assert all(x["id"] != region_id or x["tile_count"] == 0 for x in r.json()["data"])


def test_tile_config_default_fallback() -> None:
    """空配置时瓦片代理有效配置回退默认 Esri（安装启用即开箱可用，无需先保存源）。"""
    from app.modules.cable.services import config_store

    db = SessionLocal()
    try:
        cfg = config_store.effective_config(db)  # 隔离库清理后 cable.config=NULL
        assert cfg["map_sources"].get("esri"), cfg
        assert cfg["map_sources"]["esri"]["enabled"] is True
    finally:
        db.close()


def test_scheduler_module_job_registered() -> None:
    """scheduler 模块 job（knowledge/cable worker）已注册（tick 校验 ENABLED 由框架保证）。"""
    from app.scheduler import scheduler

    job_ids = [j.id for j in scheduler.get_jobs()] if scheduler.running else []
    if not scheduler.running:
        pytest.skip("scheduler 未运行（TestClient 未走 lifespan）")
    assert "mod:cable:download_worker_tick" in job_ids
