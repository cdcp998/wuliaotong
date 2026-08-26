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
    """前置：cable + map + task 安装启用（cable 依赖 map；收尾由 _data_cleanup 复位）。"""
    _login("admin", "admin123")
    client.post("/api/v1/modules/cable/install")
    client.post("/api/v1/modules/map/install")
    client.post("/api/v1/modules/map/enable")
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

def test_task_standalone_enable() -> None:
    """v1.4 任务池唯一化：task 为任务体系基座——无业务依赖门禁，可独立启用；
    依赖方向已反转：cable/device 强依赖 task（见各自模块测试）。"""
    _login("admin", "admin123")
    # 记录 cable/device 原状态（收尾还原，避免影响后续用例）
    mods = {m["code"]: m["state"] for m in client.get("/api/v1/modules").json()["data"]}
    device_was_enabled = mods.get("device") == "ENABLED"
    assert client.post("/api/v1/modules/cable/disable").json()["code"] == 0
    client.post("/api/v1/modules/device/disable")  # 未安装时静默失败即可
    assert client.post("/api/v1/modules/task/disable").json()["code"] == 0
    # 无任何业务模块 → task 仍可独立启用（基座，无循环门禁）
    r = client.post("/api/v1/modules/task/enable")
    assert r.json()["code"] == 0, r.text
    # 恢复业务模块
    assert client.post("/api/v1/modules/cable/enable").json()["code"] == 0
    if device_was_enabled:
        assert client.post("/api/v1/modules/device/enable").json()["code"] == 0
    if device_was_enabled:
        client.post("/api/v1/modules/device/enable")


def test_task_archived_filter_and_auto_link() -> None:
    """已关闭自动归档（archived 参数过滤终态）+ 历史未关联任务自动关联（同线缆补挂故障）。"""
    _login("admin", "admin123")
    # 准备：线缆（故障挂靠载体）
    code = f"T-C{_TAG}{uuid.uuid4().hex[:4]}"
    r = client.post("/api/v1/cables", json={
        "code": code, "name": "T-归档线缆", "type": "wire", "status": 1,
        "points": [{"lat": 30.06, "lng": 120.06}, {"lat": 30.061, "lng": 120.061}],
    })
    assert r.json()["code"] == 0, r.text
    cable_id = r.json()["data"]["id"]

    # 孤儿任务：仅关联线缆、无故障（历史未关联形态）
    t2 = client.post("/api/v1/tasks", json={"cable_id": cable_id, "title": "T-待自动关联任务", "priority": 2})
    assert t2.json()["code"] == 0, t2.text
    orphan_id = t2.json()["data"]["id"]

    # 活动池可见；归档池不可见
    active_ids = [x["key"] for x in client.get("/api/v1/tasks/pool").json()["data"]["items"]]
    assert f"c{orphan_id}" in active_ids
    arch_ids = [x["key"] for x in client.get("/api/v1/tasks/pool", params={"archived": 1}).json()["data"]["items"]]
    assert f"c{orphan_id}" not in arch_ids

    # 同线缆上报故障（晚于任务创建）→ 自动关联命中
    f = client.post("/api/v1/faults", json={
        "cable_id": cable_id, "lat": 30.0605, "lng": 120.0605,
        "fault_type": "T-断芯", "severity": 2, "description": "T-自动关联故障",
    })
    assert f.json()["code"] == 0
    fault_id = f.json()["data"]["id"]
    r = client.post("/api/v1/tasks/auto-link")
    assert r.json()["code"] == 0, r.text
    detail = client.get(f"/api/v1/tasks/{orphan_id}").json()["data"]
    assert detail["fault_id"] == fault_id, detail

    # 取消 → 终态进入归档视图，活动视图移除；终态不可再流转（无重开）
    r = client.post(f"/api/v1/tasks/{orphan_id}/status", json={"action": "cancel", "reason": "T-归档验证"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "cancelled"
    active_ids = [x["key"] for x in client.get("/api/v1/tasks/pool").json()["data"]["items"]]
    arch_items = client.get("/api/v1/tasks/pool", params={"archived": 1}).json()["data"]["items"]
    assert f"c{orphan_id}" not in active_ids
    assert any(x["key"] == f"c{orphan_id}" for x in arch_items)
    # 终态不可回退：任意动作被状态机拒绝
    r = client.post(f"/api/v1/tasks/{orphan_id}/status", json={"action": "close"})
    assert r.json()["code"] != 0


# ============================ 状态机全链路 ============================

def test_task_lifecycle_full_flow() -> None:
    """v2 无锁协作制全链路：发布→A领取→B接力完成→驳回退回参与者重做→A重做→审核通过即归档。"""
    _login("admin", "admin123")
    uname_a = _mk_repairer()
    uname_b = _mk_repairer()
    fault_id = _mk_fault("T-全流程故障")
    task = _mk_task(fault_id, "T-主线任务")

    # 唯一活跃约束：同故障再创建 → 拒绝
    r = client.post("/api/v1/tasks", json={"fault_id": fault_id, "title": "T-重复任务"})
    assert r.json()["code"] == 4002
    task_id = task["id"]
    assert task["status"] == "pending"

    # 维修A 领取处理：pending → in_progress，主责=A；故障联动「进行中(2)」
    _login(uname_a, "pass123")
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "claim"})
    data = r.json()["data"]
    assert r.json()["code"] == 0 and data["status"] == "in_progress" and data["assignee_id"], r.text
    _login("admin", "admin123")
    fault = client.get("/api/v1/faults", params={"status": "2"}).json()["data"]["items"]
    assert any(f["id"] == fault_id for f in fault)

    # 维修B 接力完成（过程不锁，人员留痕）：in_progress → done（待审核）
    _login(uname_b, "pass123")
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "complete"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "done", r.text
    detail = client.get(f"/api/v1/tasks/{task_id}").json()["data"]
    pnames = {p["name"] for p in detail.get("participants", [])}
    assert len(pnames) >= 1  # 留痕聚合非空
    _login("admin", "admin123")
    fault = client.get("/api/v1/faults", params={"status": "3"}).json()["data"]["items"]
    assert any(f["id"] == fault_id for f in fault)

    # 审核不通过（带理由）→ 退回参与者重做：done → in_progress
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "verify"})
    assert r.json()["code"] == 4002  # 未填结论
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "reject", "verdict": "T-熔接不合格重做"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "in_progress", r.text

    # 参与人 A 重做完成 → 审核通过即归档（closed），故障「已验证(4)」
    _login(uname_a, "pass123")
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "complete"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "done"
    _login("admin", "admin123")
    r = client.post(f"/api/v1/tasks/{task_id}/status", json={"action": "verify", "verdict": "T-复验通过"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "closed", r.text
    fault = client.get("/api/v1/faults", params={"status": "4"}).json()["data"]["items"]
    assert any(f["id"] == fault_id for f in fault)
    # 归档后故障列表仍带反向关联 linked_tasks
    flist = client.get("/api/v1/faults", params={"page_size": 100}).json()["data"]["items"]
    target = next((f for f in flist if f["id"] == fault_id), None)
    assert target is not None and any(t["id"] == task_id for t in (target.get("linked_tasks") or []))

    # 参与人可见性：已归档任务保留在参与者的历史任务单中（归档视图）
    _login(uname_b, "pass123")
    ids = [t["id"] for t in client.get("/api/v1/tasks", params={"archived": 1}).json()["data"]["items"]]
    assert task_id in ids


def test_task_complete_without_records_allowed() -> None:
    """v2 流程：处理完毕「上传图片可选」——完成任务不再强制维修记录与照片。"""
    _login("admin", "admin123")
    uname = _mk_repairer()
    fault_id = _mk_fault("T-免记录完成")
    task = _mk_task(fault_id, "T-免记录任务")
    tid = task["id"]
    _login(uname, "pass123")
    assert client.post(f"/api/v1/tasks/{tid}/status", json={"action": "claim"}).json()["code"] == 0
    r = client.post(f"/api/v1/tasks/{tid}/status", json={"action": "complete"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "done", r.text


def test_task_pool_merges_cable_and_device() -> None:
    """统一任务池：/tasks/pool 合并线缆任务（含故障关联信息）；device 模块启用时含设备任务。"""
    _login("admin", "admin123")
    fault_id = _mk_fault("T-池联动故障")
    task = _mk_task(fault_id, "T-池联动任务")
    r = client.get("/api/v1/tasks/pool", params={})
    assert r.json()["code"] == 0, r.text
    items = r.json()["data"]["items"]
    mine = next((x for x in items if x.get("key") == f"c{task['id']}"), None)
    assert mine is not None and mine["source"] == "cable" and mine["fault_id"] == fault_id
    assert mine["fault_type"] == "T-断芯" and mine["fault_status"] == 0  # 故障实时状态随任务流转（待派发）

    # source 过滤：仅设备任务时不含线缆任务
    r = client.get("/api/v1/tasks/pool", params={"source": "device"})
    assert all(x["source"] != "cable" for x in r.json()["data"]["items"])


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

    # 数据范围（v2 领取制）：已取消且未被领取的任务 → 归档，维修工不可见
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
