"""task 模块（P3，L2 门禁）：依赖校验/任务状态机（派发-接单-完成-验收-关闭/取消）/唯一活跃约束/
维修记录+照片/数据范围/故障联动。

前置：cable 模块已安装启用（本模块 fixture 处理）；task 模块安装启用。
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
    """前置：cable + task 安装启用（收尾由 _data_cleanup 复位）。"""
    _login("admin", "admin123")
    client.post("/api/v1/modules/cable/install")
    client.post("/api/v1/modules/cable/enable")
    client.post("/api/v1/modules/task/install")
    r = client.post("/api/v1/modules/task/enable")
    assert r.json()["code"] == 0, r.text
    yield


def _mk_fault(desc: str) -> int:
    r = client.post("/api/v1/faults", json={"lat": 30.05, "lng": 120.05, "fault_type": "T-断芯", "severity": 2, "description": desc})
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["id"]


def _mk_task(fault_id: int | None, title: str) -> dict:
    r = client.post("/api/v1/tasks", json={"fault_id": fault_id, "title": title, "priority": 2})
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]


def _mk_repairer() -> str:
    uname = f"fg{_TAG}{uuid.uuid4().hex[:4]}"
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "real_name": "维修工", "role_id": 6})
    assert r.json()["code"] == 0, r.text
    return uname


def _mk_file() -> int:
    db = SessionLocal()
    try:
        db.execute(text(
            "INSERT INTO sys_file (biz_type, biz_id, storage_id, original_name, file_path, file_size, md5, uploader_id) "
            "VALUES ('task_test', 0, 1, 'T-task.png', 'data/files/t-task.png', 10, 'x', 1)"
        ))
        db.commit()
        return db.execute(text("SELECT id FROM sys_file WHERE original_name = 'T-task.png' ORDER BY id DESC LIMIT 1")).scalar()
    finally:
        db.close()


def _cleanup_file(file_id: int) -> None:
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM sys_file WHERE id = :i"), {"i": file_id})
        db.commit()
    finally:
        db.close()


# ============================ 依赖校验（模块机制） ============================

def test_task_dependency_enforcement() -> None:
    """cable 停用 → task 启用被拒（依赖不满足 → ERROR）；cable 恢复后重新启用成功。"""
    _login("admin", "admin123")
    # 停用 cable（task 已启用时：loader 只在校验时置 ERROR；这里验证 enable 时的依赖检查）
    assert client.post("/api/v1/modules/cable/disable").json()["code"] == 0
    assert client.post("/api/v1/modules/task/disable").json()["code"] == 0
    r = client.post("/api/v1/modules/task/enable")
    assert r.json()["code"] == 4002  # 依赖不满足 → 拒绝
    # 恢复 cable → task 启用成功
    assert client.post("/api/v1/modules/cable/enable").json()["code"] == 0
    r = client.post("/api/v1/modules/task/enable")
    assert r.json()["code"] == 0, r.text


# ============================ 状态机全链路 ============================

def test_task_lifecycle_full_flow() -> None:
    _login("admin", "admin123")
    uname = _mk_repairer()
    fault_id = _mk_fault("T-全流程故障")
    task = _mk_task(fault_id, "T-主线任务")

    # 唯一活跃约束：同故障再创建 → 拒绝
    r = client.post("/api/v1/tasks", json={"fault_id": fault_id, "title": "T-重复任务"})
    assert r.json()["code"] == 4002
    task_id = task["id"]
    assert task["status"] == "pending"

    # 派发（调度员）→ 通知
    rep_user = None
    r = client.get("/api/v1/users", params={"keyword": uname})
    for row in r.json()["data"]["list"]:
        if row["username"] == uname:
            rep_user = row["id"]
    assert rep_user is not None
    r = client.post(f"/api/v1/tasks/{task_id}/assign", json={"assignee_id": rep_user})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "assigned", r.text

    # 接单（维修工）
    _login(uname, "pass123")
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "accept"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "in_progress", r.text

    # 维修记录 + 照片
    file_id = _mk_file()
    r = client.post(f"/api/v1/tasks/{task_id}/records", json={
        "content": "T-更换断芯并熔接",
        "materials_used": [{"name": "光纤熔接管", "qty": 2}],
        "files": [{"file_id": file_id, "category": "维修后"}],
    })
    assert r.json()["code"] == 0, r.text

    # 完成 → 故障进入「待验证(2)」（管理员视角验证联动）
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "complete"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "done", r.text
    _login("admin", "admin123")
    fault = client.get("/api/v1/faults", params={"status": "2"}).json()["data"]["items"]
    assert any(f["id"] == fault_id for f in fault)

    # 验收（调度员）→ 故障「已修复(3)」；verdict 必填
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "verify"})
    assert r.json()["code"] == 4002  # 未填结论
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "verify", "verdict": "T-验收通过"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "verified", r.text
    fault = client.get("/api/v1/faults", params={"status": "3"}).json()["data"]["items"]
    assert any(f["id"] == fault_id for f in fault)

    # 关闭（终态）
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "close"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "closed"
    _cleanup_file(file_id)


def test_task_cancel_and_scope() -> None:
    _login("admin", "admin123")
    uname = _mk_repairer()
    fault_id = _mk_fault("T-取消故障")
    task = _mk_task(fault_id, "T-取消任务")
    task_id = task["id"]

    # 取消必须填原因
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "cancel"})
    assert r.json()["code"] == 4002
    # 取消 → 故障回「待处理(0)」
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "cancel", "reason": "T-计划调整"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "cancelled"
    fault = client.get("/api/v1/faults", params={"status": "0"}).json()["data"]["items"]
    assert any(f["id"] == fault_id for f in fault)

    # 数据范围：维修工只能看到被指派任务（未指派任务不可见）
    _login(uname, "pass123")
    r = client.get("/api/v1/tasks")
    assert r.json()["code"] == 0
    assert all(t["id"] != task_id for t in r.json()["data"]["items"])


def test_task_requisition_link_and_cancel_guard() -> None:
    """任务→物料领用：复用领用体系创建（同事务链接）；有关联领用的任务禁止直接取消。"""
    _login("admin", "admin123")
    fault_id = _mk_fault("T-领用故障")
    task = _mk_task(fault_id, "T-领用任务")
    task_id = task["id"]

    # 准备：商品 + 库位（用测试数据创建）
    r = client.get("/api/v1/products", params={"page_size": 1})
    assert r.json()["code"] == 0
    r = client.get("/api/v1/warehouses")
    assert r.json()["code"] == 0
    # 直接查询一条可用商品与库位（复用已有测试数据），无则跳过本段
    db = SessionLocal()
    try:
        prod = db.execute(text("SELECT p.id, p.name FROM base_product p WHERE p.status = 1 LIMIT 1")).fetchone()
        loc = db.execute(text("SELECT l.id FROM base_location l LIMIT 1")).fetchone()
        wh = db.execute(text("SELECT w.id FROM base_warehouse w LIMIT 1")).fetchone()
    finally:
        db.close()
    if not (prod and loc and wh):
        return  # 无基础数据，跳过（成本拆单测试）

    r = client.post(f"/api/v1/tasks/{task_id}/requisitions", json={
        "warehouse_id": wh[0], "use_location": "T-测试点", "use_reason": "T-维修领用",
        "items": [{"product_id": prod[0], "qty": "1", "location_id": loc[0]}],
    })
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["bill_no"].startswith("LL")

    # 关联领用单列表
    r = client.get(f"/api/v1/tasks/{task_id}/requisitions")
    assert r.json()["code"] == 0 and len(r.json()["data"]) == 1

    # 已领用 → 禁止直接取消
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "cancel", "reason": "T-取消"})
    assert r.json()["code"] == 4002
