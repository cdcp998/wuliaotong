"""device 模块（P5，L2 门禁）：设备台账/生命周期规则 + 设备维修任务（task_engine 复用/状态快照回退）。

前置：cable/task/knowledge 由 test 文件顺序保证（本模块 fixture 仅安装启用 device/task/cable）。
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import SessionLocal
from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login(username: str, password: str) -> None:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200 and r.json()["code"] == 0, r.text


@pytest.fixture(scope="module", autouse=True)
def _ensure_modules():
    _login("admin", "admin123")
    for code in ("cable", "map", "task", "device"):
        client.post(f"/api/v1/modules/{code}/install")
    # 启用顺序须满足依赖：cable 依赖 task（task 先启用）；map 无依赖排最前
    for code in ("map", "task", "cable", "device"):
        r = client.post(f"/api/v1/modules/{code}/enable")
        assert r.json()["code"] == 0, r.text
    yield


def _mk_device(code: str | None = None) -> dict:
    r = client.post("/api/v1/devices", json={
        "code": code or f"T-{_TAG}{uuid.uuid4().hex[:4]}", "name": "T-熔接机", "model": "FSM-80S",
        "category": "熔接设备", "location": "T-一号机房", "lat": 30.1, "lng": 120.1, "status": 1,
    })
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]


def _mk_repairer() -> tuple[str, int]:
    uname = f"fg{_TAG}{uuid.uuid4().hex[:4]}"
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "real_name": "维修工", "role_id": 6})
    assert r.json()["code"] == 0, r.text
    r = client.get("/api/v1/users", params={"keyword": uname})
    for row in r.json()["data"]["list"]:
        if row["username"] == uname:
            return uname, row["id"]
    raise AssertionError("repairer not found")


def _mk_file() -> int:
    db = SessionLocal()
    try:
        db.execute(text(
            "INSERT INTO sys_file (biz_type, biz_id, storage_id, original_name, file_path, file_size, md5, uploader_id) "
            "VALUES ('device_test', 0, 1, 'T-dtask.png', 'data/files/x.png', 10, 'x', 1)"
        ))
        db.commit()
        return db.execute(text("SELECT id FROM sys_file WHERE original_name = 'T-dtask.png' ORDER BY id DESC LIMIT 1")).scalar()
    finally:
        db.close()


def _cleanup_file(file_id: int) -> None:
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM sys_file WHERE id = :i"), {"i": file_id})
        db.commit()
    finally:
        db.close()


# ============================ 模块依赖 ============================

def test_device_dependency_on_task() -> None:
    """v1.2 系统重构·强依赖：task 停用 → device 启用被拒（4002）；恢复后可再启用。

    任务管理是唯一任务池与派发入口；设备自有任务池（公开领取）已移除。"""
    _login("admin", "admin123")
    assert client.post("/api/v1/modules/task/disable").json()["code"] == 0
    assert client.post("/api/v1/modules/device/disable").json()["code"] == 0
    r = client.post("/api/v1/modules/device/enable")
    assert r.json()["code"] == 4002  # 依赖不满足 → 拒绝
    assert client.post("/api/v1/modules/task/enable").json()["code"] == 0
    r = client.post("/api/v1/modules/device/enable")
    assert r.json()["code"] == 0, r.text


# ============================ 台账与生命周期 ============================

def test_device_lifecycle_rules() -> None:
    _login("admin", "admin123")
    d = _mk_device()
    did = d["id"]
    assert d["status"] == 1

    # 维修中(2) 禁止报废(4)
    r = client.put(f"/api/v1/devices/{did}/status", json={"status": 2})
    assert r.json()["code"] == 0
    r = client.put(f"/api/v1/devices/{did}/status", json={"status": 4})
    assert r.json()["code"] == 4002  # 维修中禁止报废
    # 维修中 → 在用（恢复）
    r = client.put(f"/api/v1/devices/{did}/status", json={"status": 1})
    assert r.json()["code"] == 0
    # 在用 → 闲置 → 报废
    assert client.put(f"/api/v1/devices/{did}/status", json={"status": 3}).json()["code"] == 0
    assert client.put(f"/api/v1/devices/{did}/status", json={"status": 4}).json()["code"] == 0
    # 报废 → 不可编辑状态流转
    r = client.put(f"/api/v1/devices/{did}/status", json={"status": 1})
    assert r.json()["code"] == 4002

    # 报废设备不可创建维修任务
    r = client.post("/api/v1/device-tasks", json={"device_id": did, "title": "T-报废机维修"})
    assert r.json()["code"] == 4002


def test_device_task_full_flow_and_snapshot_rollback() -> None:
    _login("admin", "admin123")
    d = _mk_device()
    did = d["id"]
    uname, _rep_id = _mk_repairer()

    # 创建任务 → 设备自动置维修中 + previous_status 快照=1
    r = client.post("/api/v1/device-tasks", json={"device_id": did, "title": "T-熔接机保养", "priority": 2})
    assert r.json()["code"] == 0, r.text
    dt = r.json()["data"]
    tid = dt["id"]
    assert dt["status"] == "pending" and dt["previous_status"] == 1
    dev = client.get(f"/api/v1/devices/{did}").json()["data"]
    assert dev["status"] == 2

    # 唯一活跃设备任务
    r = client.post("/api/v1/device-tasks", json={"device_id": did, "title": "T-重复任务"})
    assert r.json()["code"] == 4002

    # 领取处理（维修人员自助，v2 任务池领取制）→ 记录+照片（可选，仍支持）→ 完成
    _login(uname, "pass123")
    r = client.post(f"/api/v1/device-tasks/{tid}/status", json={"action": "claim"})
    d2 = r.json()["data"]
    assert r.json()["code"] == 0 and d2["status"] == "in_progress" and d2["assignee_id"], r.text
    file_id = _mk_file()
    r = client.post(f"/api/v1/device-tasks/{tid}/records", json={"content": "T-更换光模块", "files": [{"file_id": file_id}]})
    assert r.json()["code"] == 0
    r = client.post(f"/api/v1/device-tasks/{tid}/status", json={"action": "complete"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "done", r.text
    dev = client.get(f"/api/v1/devices/{did}").json()["data"]
    assert dev["status"] == 2  # 完成未验收 → 仍维修中

    # 后台审核（v2：审核通过即归档 closed）→ 设备按快照自动回退到在用(1)
    _login("admin", "admin123")
    r = client.post(f"/api/v1/device-tasks/{tid}/status", json={"action": "verify", "verdict": "T-验收合格"})
    data = r.json()["data"]
    assert r.json()["code"] == 0 and data["status"] == "closed"
    dev = client.get(f"/api/v1/devices/{did}").json()["data"]
    assert dev["status"] == 1
    # 参与留痕：领取/完成事件已记录（聚合非空）
    r = client.get("/api/v1/device-tasks", params={"page_size": 50})
    row = next((x for x in r.json()["data"]["items"] if x["id"] == tid), None)
    assert row is not None and len(row.get("participants") or []) >= 1
    _cleanup_file(file_id)


def test_device_images_flow() -> None:
    """设备图片：上传关联 → 列表 cover → 删除关联（M0001 device_file）；定位坐标协同。"""
    _login("admin", "admin123")
    d = _mk_device()
    did = d["id"]
    # 定位坐标（模拟手机端定位获取）：设备无坐标时列表返回 null，更新后带出
    r = client.put(f"/api/v1/devices/{did}", json={"lat": 30.1234567, "lng": 120.1234567, "location": "T-机房定位"})
    assert r.json()["code"] == 0 and r.json()["data"]["lat"] == 30.1234567

    db = SessionLocal()
    try:
        db.execute(text(
            "INSERT INTO sys_file (biz_type, biz_id, storage_id, original_name, file_path, file_size, md5, uploader_id) "
            "VALUES ('device', 0, 1, 'T-dev.png', 'data/files/x.png', 10, 'x', 1)"
        ))
        db.commit()
        file_id = db.execute(text("SELECT id FROM sys_file WHERE original_name = 'T-dev.png' ORDER BY id DESC LIMIT 1")).scalar()
    finally:
        db.close()

    r = client.post(f"/api/v1/devices/{did}/files", json={"file_id": file_id})
    assert r.json()["code"] == 0
    link_id = r.json()["data"]["id"]
    # 列表带 cover_file_id + files 接口
    r = client.get("/api/v1/devices", params={"keyword": "T-"})
    row = next((x for x in r.json()["data"]["items"] if x["id"] == did), None)
    assert row is not None and row["cover_file_id"] == file_id
    r = client.get(f"/api/v1/devices/{did}/files")
    assert r.json()["code"] == 0 and len(r.json()["data"]) == 1
    # 删除关联后 cover 消失
    assert client.delete(f"/api/v1/devices/{did}/files/{link_id}").json()["code"] == 0
    r = client.get(f"/api/v1/devices/{did}/files")
    assert r.json()["data"] == []
    # 清理文件记录
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM sys_file WHERE id = :i"), {"i": file_id})
        db.commit()
    finally:
        db.close()


def test_device_task_cancel_rollback_and_scope() -> None:
    _login("admin", "admin123")
    d = _mk_device()
    did = d["id"]
    uname, _rep_id = _mk_repairer()
    r = client.post("/api/v1/device-tasks", json={"device_id": did, "title": "T-取消保养"})
    assert r.json()["code"] == 0
    tid = r.json()["data"]["id"]

    # 取消（未被领取，pending 直接取消）→ 设备回退快照(1)
    r = client.post(f"/api/v1/device-tasks/{tid}/status", json={"action": "cancel", "reason": "T-计划调整"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "cancelled"
    dev = client.get(f"/api/v1/devices/{did}").json()["data"]
    assert dev["status"] == 1

    # 待领取任务（管理员发布，进入任务池）
    d2 = _mk_device()
    r = client.post("/api/v1/device-tasks", json={"device_id": d2["id"], "title": "T-待领取设备任务"})
    assert r.json()["code"] == 0
    pool_id = r.json()["data"]["id"]
    # 数据范围（v2 领取制）：维修工可见「待领取池内任务」；已取消且未领取的任务不可见
    _login(uname, "pass123")
    r = client.get("/api/v1/device-tasks")
    assert r.json()["code"] == 0
    ids = [t["id"] for t in r.json()["data"]["items"]]
    assert tid not in ids  # 已取消且未被领取 → 归档，不可见
    assert pool_id in ids  # 待领取 → 任务池对维修人员可见
