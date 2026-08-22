"""模块插件机制（P0）+ cable 模块基础（P1）测试（L2 门禁）。

覆盖：
- 模块管理接口：权限（module:manage）、安装/启停/升级/卸载、幂等、卸载不删数据
- 模块未启用 → 接口 403（4009），停用后权限点从 /auth/me 消失
- cable：线缆 CRUD（长度/累计距离）、标记点、故障、测距/导航、地图源配置
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models import SysModule, SysModuleMigration

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login(username: str, password: str) -> None:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200 and r.json()["code"] == 0, r.text


@pytest.fixture(scope="module", autouse=True)
def _ensure_cable_installed():
    """前置：cable 模块安装并启用（保证测试可运行；收尾由 _data_cleanup 复位隔离库）。"""
    _login("admin", "admin123")
    client.post("/api/v1/modules/cable/install")
    r = client.post("/api/v1/modules/cable/enable")
    assert r.json()["code"] == 0, r.text
    yield
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})


# ============================ 模块管理 ============================

def test_module_access_control() -> None:
    # 未登录 → 401
    c = TestClient(app)
    assert c.get("/api/v1/modules").status_code == 401
    # 普通用户无 module:manage → 403
    _login("tester_user", "123456")
    r = client.get("/api/v1/modules")
    assert r.status_code == 403 and r.json()["code"] == 4005


def test_module_list_install_upgrade() -> None:
    _login("admin", "admin123")
    r = client.get("/api/v1/modules")
    assert r.json()["code"] == 0
    row = next(m for m in r.json()["data"] if m["code"] == "cable")
    assert row["deployed"] is True and row["state"] == "ENABLED"
    assert row["source_version"] == "1.0.0" and row["version"] == "1.0.0"
    assert row["menu_count"] == 5 and row["perm_count"] == 6

    # 已启用状态下重复安装 → 拒绝（状态机：先停用再重装）
    r = client.post("/api/v1/modules/cable/install")
    assert r.json()["code"] == 4002

    # 升级（无新迁移 → 幂等成功，版本不变）
    r = client.post("/api/v1/modules/cable/upgrade")
    assert r.json()["code"] == 0
    assert r.json()["data"]["version"] == "1.0.0"

    # baseline 迁移记录已写（checksum 拦截基础）
    db = SessionLocal()
    try:
        rec = db.scalar(
            select(SysModuleMigration).where(
                SysModuleMigration.module_code == "cable",
                SysModuleMigration.version == "baseline",
            )
        )
        assert rec is not None and rec.success == 1 and len(rec.checksum) == 64
    finally:
        db.close()


def test_module_uninstall_keeps_data_and_reinstall() -> None:
    _login("admin", "admin123")
    code = f"T-{_TAG}"
    # 创建线缆（已启用）
    r = client.post("/api/v1/cables", json={
        "code": code, "name": "测试线缆", "type": "wire",
        "points": [{"lat": 30.0, "lng": 120.0}, {"lat": 30.001, "lng": 120.001}],
    })
    assert r.json()["code"] == 0, r.text
    cable_id = r.json()["data"]["id"]

    # 停用 → 卸载
    assert client.post("/api/v1/modules/cable/disable").json()["code"] == 0
    assert client.post("/api/v1/modules/cable/uninstall").json()["code"] == 0
    r = client.get("/api/v1/modules")
    row = next(m for m in r.json()["data"] if m["code"] == "cable")
    assert row["state"] == "NOT_INSTALLED"

    # 接口 403（模块未启用）
    r = client.get("/api/v1/cables")
    assert r.status_code == 403 and r.json()["code"] == 4009

    # 数据红线：卸载不删表不删数据
    db = SessionLocal()
    try:
        from sqlalchemy import text

        cnt = db.execute(text("SELECT COUNT(*) FROM cable WHERE code = :c"), {"c": code}).scalar()
        assert cnt == 1
        cnt_pts = db.execute(
            text("SELECT COUNT(*) FROM cable_point WHERE cable_id = :i"), {"i": cable_id}
        ).scalar()
        assert cnt_pts == 2
    finally:
        db.close()

    # 重装幂等续用：数据仍在
    assert client.post("/api/v1/modules/cable/install").json()["code"] == 0
    assert client.post("/api/v1/modules/cable/enable").json()["code"] == 0
    r = client.get("/api/v1/cables", params={"keyword": code})
    assert r.json()["code"] == 0 and r.json()["data"]["total"] == 1
    r = client.get(f"/api/v1/cables/{cable_id}")
    assert r.json()["data"]["code"] == code and len(r.json()["data"]["points"]) == 2


# ============================ cable 业务 ============================

def test_cable_crud_and_geo() -> None:
    _login("admin", "admin123")
    code = f"T-C-{_TAG}"
    pts = [
        {"lat": 30.0000, "lng": 120.0000},
        {"lat": 30.0010, "lng": 120.0000},
        {"lat": 30.0010, "lng": 120.0010},
    ]
    r = client.post("/api/v1/cables", json={"code": code, "name": "T-测量线缆", "type": "fiber", "points": pts})
    assert r.json()["code"] == 0, r.text
    cable_id = r.json()["data"]["id"]
    total = r.json()["data"]["total_length"]

    # 长度 ≈ 两段 haversine 之和（精度 1m 容差）
    import math

    def hav(a, b, c, d):
        from app.modules.cable.services import geo_math

        return geo_math.haversine(a, b, c, d)

    expect = hav(30.0, 120.0, 30.001, 120.0) + hav(30.001, 120.0, 30.001, 120.001)
    assert abs(total - expect) < 1.0, (total, expect)

    # 详情含节点
    r = client.get(f"/api/v1/cables/{cable_id}")
    assert len(r.json()["data"]["points"]) == 3
    assert r.json()["data"]["points"][-1]["cumulative_distance"] == pytest.approx(expect, abs=1.0)

    # 重复编码拒绝
    r = client.post("/api/v1/cables", json={"code": code, "name": "重复", "points": pts})
    assert r.json()["code"] == 4006

    # 测距定位
    r = client.post("/api/v1/geo/measure", json={"cable_id": cable_id, "distance": expect / 2})
    assert r.json()["code"] == 0
    data = r.json()["data"]
    assert abs(data["cumulative_distance"] - expect / 2) < 0.01
    assert data["total_length"] == pytest.approx(total, abs=0.01)

    # 越界拒绝
    r = client.post("/api/v1/geo/measure", json={"cable_id": cable_id, "distance": expect * 2})
    assert r.json()["code"] == 4006

    # 标记点
    r = client.post(f"/api/v1/cables/{cable_id}/markers", json={
        "lat": 30.0005, "lng": 120.0, "marker_type": "接头", "label": "1# 接头",
    })
    assert r.json()["code"] == 0
    marker_id = r.json()["data"]["id"]
    r = client.get(f"/api/v1/cables/{cable_id}/markers")
    assert len(r.json()["data"]) == 1
    assert client.delete(f"/api/v1/cables/{cable_id}/markers/{marker_id}").json()["code"] == 0

    # 故障上报 + 列表 + 状态流转
    r = client.post("/api/v1/faults", json={
        "cable_id": cable_id, "lat": 30.0007, "lng": 120.0, "fault_type": "断芯",
        "severity": 3, "description": "T-测试故障",
    })
    assert r.json()["code"] == 0
    fault_id = r.json()["data"]["id"]
    r = client.get("/api/v1/faults", params={"severity": 3})
    assert any(f["id"] == fault_id for f in r.json()["data"]["items"])
    # 附近故障（仅活跃 0-2；先在状态流转前验证）
    r = client.get("/api/v1/geo/nearby-faults", params={"lat": 30.0007, "lng": 120.0, "radius": 200})
    assert any(f["id"] == fault_id for f in r.json()["data"]["items"])
    r = client.put(f"/api/v1/faults/{fault_id}/status", json={"status": 3})
    assert r.json()["code"] == 0

    # 故障导航（用户在线缆附近；不受 fault.status 限制）
    r = client.post("/api/v1/geo/navigate", json={"lat": 30.0005, "lng": 120.0, "fault_id": fault_id, "heading": 0})
    assert r.json()["code"] == 0
    nav = r.json()["data"]
    assert nav["projection"] is not None and nav["remaining_distance"] >= 0
    assert nav["path"] and len(nav["path"]) >= 2


def test_fault_data_scope_and_permission_filter() -> None:
    """数据范围：维修人员仅见本人上报；模块停用 → 权限点失效 + 接口 403。"""
    _login("admin", "admin123")
    uname = f"fg{_TAG}"
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "real_name": "维修测试", "role_id": 6})
    assert r.json()["code"] == 0, r.text

    # 停用后再启用（幂等）：重复启用返回 0
    assert client.post("/api/v1/modules/cable/enable").json()["code"] == 0

    _login(uname, "pass123")
    r = client.post("/api/v1/faults", json={
        "lat": 30.01, "lng": 120.01, "fault_type": "T-断芯", "severity": 2, "description": "T-维修上报",
    })
    assert r.json()["code"] == 0
    own_fault_id = r.json()["data"]["id"]
    r = client.get("/api/v1/faults")
    ids = [f["id"] for f in r.json()["data"]["items"]]
    assert own_fault_id in ids

    # 维修人员权限点包含 cable:view / fault:report（模块启用时）
    r = client.get("/api/v1/auth/me")
    perms = r.json()["data"]["user"]["permissions"]
    assert "cable:view" in perms and "fault:report" in perms

    # 管理员停用模块 → 权限点失效 + 接口 403
    _login("admin", "admin123")
    assert client.post("/api/v1/modules/cable/disable").json()["code"] == 0
    _login(uname, "pass123")
    r = client.get("/api/v1/auth/me")
    perms = r.json()["data"]["user"]["permissions"]
    assert "cable:view" not in perms and "fault:report" not in perms
    r = client.get("/api/v1/cables")
    assert r.status_code == 403 and r.json()["code"] == 4009
    # 菜单隐藏：/menus 不含线缆管理分组
    r = client.get("/api/v1/menus")
    names = [m["name"] for m in r.json()["data"]]
    assert "线缆管理" not in names

    # 恢复
    _login("admin", "admin123")
    assert client.post("/api/v1/modules/cable/enable").json()["code"] == 0


def test_fault_photos_link_and_list() -> None:
    """故障照片关联：POST /faults/{id}/photos 记录 → GET /faults/{id}/photos 返回文件 URL。"""
    _login("admin", "admin123")
    r = client.post("/api/v1/faults", json={
        "lat": 30.02, "lng": 120.02, "fault_type": "T-断纤", "severity": 2, "description": "T-照片测试",
    })
    assert r.json()["code"] == 0
    fault_id = r.json()["data"]["id"]

    from app.db import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text(
            "INSERT INTO sys_file (biz_type, biz_id, storage_id, original_name, file_path, file_size, md5, uploader_id) "
            "VALUES ('fault_test', 0, 1, 'T-test.png', 'data/files/t-test.png', 10, 'x', 1)"
        ))
        db.commit()
        file_id = db.execute(text("SELECT id FROM sys_file WHERE original_name = 'T-test.png' ORDER BY id DESC LIMIT 1")).scalar()
    finally:
        db.close()

    r = client.post(f"/api/v1/faults/{fault_id}/photos", json={"file_id": file_id, "category": "现场"})
    assert r.json()["code"] == 0
    r = client.get(f"/api/v1/faults/{fault_id}/photos")
    assert r.json()["code"] == 0
    items = r.json()["data"]
    assert len(items) == 1 and items[0]["url"] == f"/files/{file_id}"

    # 清理测试文件记录（磁盘文件不存在，仅删记录）
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM sys_file WHERE id = :i"), {"i": file_id})
        db.commit()
    finally:
        db.close()


def test_cable_import_export() -> None:
    """GeoJSON 导入/导出：导出内容可回导入（长度/节点重建）。"""
    _login("admin", "admin123")
    r = client.post("/api/v1/cables/import", json={
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"code": f"T-IMP-{_TAG}", "name": "导入线缆", "type": "network", "status": 1},
                "geometry": {"type": "LineString", "coordinates": [[120.0, 30.0], [120.01, 30.0], [120.01, 30.01]]},
            },
            {"type": "Feature", "properties": {"code": "T-IMP-BAD"}, "geometry": {"type": "Point", "coordinates": [1, 2]}},
        ],
    })
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["created"] == 1 and len(data["skipped"]) == 1

    r = client.get("/api/v1/cables/export")
    assert r.json()["code"] == 0
    fc = r.json()["data"]
    assert fc["type"] == "FeatureCollection"
    feat = next((f for f in fc["features"] if f["properties"]["code"] == f"T-IMP-{_TAG}"), None)
    assert feat is not None and len(feat["geometry"]["coordinates"]) == 3
    assert feat["properties"]["total_length"] > 0


def test_map_sources_config() -> None:
    _login("admin", "admin123")
    esri_default = {
        "key": "esri", "name": "Esri 影像", "type": "esri", "coordinate_space": "wgs84",
        "url_template": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "enabled": True,
    }
    # 预置默认源（幂等；隔离库清理在模块结束后执行，兼容历史残留）
    assert client.put("/api/v1/map/sources", json=[esri_default]).json()["code"] == 0
    # 默认源存在且脱敏
    r = client.get("/api/v1/map/sources")
    assert r.json()["code"] == 0
    sources = r.json()["data"]["map_sources"]
    assert "esri" in sources

    # 保存自定义源（含 secret，回读必须脱敏）
    r = client.put("/api/v1/map/sources", json=[{
        "key": "test-src", "name": "测试源", "type": "xyz", "coordinate_space": "wgs84",
        "url_template": "https://example.com/{z}/{x}/{y}.png", "api_secret": "SECRET-123", "enabled": True,
    }])
    assert r.json()["code"] == 0
    r = client.get("/api/v1/map/sources")
    src = r.json()["data"]["map_sources"]["test-src"]
    assert src["api_secret"] == "******"
    assert r.json()["data"]["map_sources"].get("esri") is not None  # 合并保存：默认源仍在

    # 恢复默认（仅 esri）
    r = client.put("/api/v1/map/sources", json=[esri_default])
    assert r.json()["code"] == 0
