"""领用流程测试（P3，L2 门禁）。

覆盖：使用者申请（必填校验）、我的申请、仓管员审计通过（扣库存+流水+通知）、
库存不足整单回滚、驳回→修改重提、取消、权限（user 不能审计 / 越权查看 403）。
"""
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _login_tester() -> TestClient:
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.json()["code"] == 0
    return c


def _setup_stock(qty: str = "50") -> tuple[int, int, int]:
    """建 仓库+库位+商品并入库 qty 件，返回 (warehouse_id, location_id, product_id)。"""
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "WH" + tag, "name": "P3仓"})
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "A1"})
    shelf_id = r.json()["data"]["id"]
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": shelf_id, "layer_no": 1})
    loc_id = r.json()["data"]["id"]

    client.post("/api/v1/units", json={"name": "P3件" + tag})
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "9" + str(int(tag, 16) % 10**9), "name": "P3物料", "unit_id": unit_id})
    pid = r.json()["data"]["id"]

    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": qty, "price": "1.00", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    return wh_id, loc_id, pid


def _stock_qty(product_id: int) -> str:
    rows = client.get(f"/api/v1/stock?product_id={product_id}").json()["data"]["list"]
    return rows[0]["qty"] if rows else "0"


def test_requisition_full_flow():
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("50")
    c = _login_tester()

    # 使用者申请（必填项校验：缺使用地点 → 4006）
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_reason": "维修设备",
        "items": [{"product_id": pid, "qty": "10", "location_id": loc_id}],
    })
    assert r.json()["code"] == 4006

    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "三号车间", "use_reason": "维修设备",
        "location_photo_file_id": 12345,
        "items": [{"product_id": pid, "qty": "10", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    req_id = r.json()["data"]["id"]
    bill_no = r.json()["data"]["bill_no"]
    assert bill_no.startswith("LL") and r.json()["data"]["status"] == 1

    # 提交即自动出库：库存 50-10=40、流水、使用地点照片已保存
    assert _stock_qty(pid) == "40.000"
    flow = client.get(f"/api/v1/stock/flow?product_id={pid}").json()["data"]["list"]
    assert flow[0]["change_type"] == "领用出库" and flow[0]["change_qty"] == "-10.000"

    # 我的申请（历史累积，断言最新一条为本单）
    mine = c.get("/api/v1/requisitions/my").json()["data"]
    assert mine["total"] >= 1 and mine["list"][0]["id"] == req_id

    # 仓管员（admin）待审计列表
    lst = client.get("/api/v1/requisitions?status=1").json()["data"]
    assert any(x["id"] == req_id for x in lst["list"])

    # 审计通过 → 仅确认状态（库存已扣），申请人收到通知
    r = client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "approve", "remark": "同意"})
    assert r.json()["code"] == 0, r.text
    assert _stock_qty(pid) == "40.000"
    # 详情含审计信息 + 使用地点照片
    detail = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert detail["status"] == 2 and detail["audit_name"] == "超级管理员"
    assert detail["location_photo_file_id"] == 12345
    # 申请人通知
    notif = c.get("/api/v1/notifications").json()["data"]
    assert notif["total"] >= 1 and any("已通过" in n["title"] for n in notif["list"])

    # 已审计不可再审 → 4002
    assert client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "reject"}).json()["code"] == 4002


def test_requisition_negative_stock_notifies_admin():
    """库存不足不再拦截：自动出库允许负库存（实物与系统账可能不符），并通知管理员核对。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("5")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "一车间", "use_reason": "领 10 件",
        "items": [{"product_id": pid, "qty": "10", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    # 库存 5 - 10 = -5（负库存出库成功）
    assert _stock_qty(pid) == "-5.000"
    # 响应带 shortage 提示
    assert r.json()["data"]["shortages"]
    # 管理员（admin 为超管）收到库存不足通知
    notif = client.get("/api/v1/notifications").json()["data"]
    assert any("库存不足" in n["title"] for n in notif["list"])
    # 审计仍可正常通过（状态确认）
    req_id = r.json()["data"]["id"]
    r = client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "approve"})
    assert r.json()["code"] == 0, r.text
    assert _stock_qty(pid) == "-5.000"


def test_requisition_reject_resubmit_cancel():
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("20")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "二车间", "use_reason": "试用",
        "items": [{"product_id": pid, "qty": "2", "location_id": loc_id}],
    })
    req_id = r.json()["data"]["id"]
    assert _stock_qty(pid) == "18.000"  # 提交即自动出库 20-2

    # 驳回 → 状态 3 + 库存回补
    r = client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "reject", "remark": "数量写错"})
    assert r.json()["code"] == 0
    assert client.get(f"/api/v1/requisitions/{req_id}").json()["data"]["status"] == 3
    assert _stock_qty(pid) == "20.000"  # 驳回回补
    flow = client.get(f"/api/v1/stock/flow?product_id={pid}").json()["data"]["list"]
    assert any(f["change_type"] == "领用驳回回补" for f in flow)

    # 修改后重新提交 → 回待审计 + 再次自动出库
    r = c.put(f"/api/v1/requisitions/{req_id}", json={
        "warehouse_id": wh_id, "use_location": "二车间", "use_reason": "修正后重提",
        "items": [{"product_id": pid, "qty": "3", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    detail = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert detail["status"] == 1 and detail["items"][0]["qty"] == "3.000"
    assert _stock_qty(pid) == "17.000"  # 重提 3 件再次出库

    # 取消（待审计）→ 状态 4 + 库存回补
    r = c.post(f"/api/v1/requisitions/{req_id}/cancel")
    assert r.json()["code"] == 0
    assert client.get(f"/api/v1/requisitions/{req_id}").json()["data"]["status"] == 4
    assert _stock_qty(pid) == "20.000"  # 取消回补
    # 已取消不能再审
    assert client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "approve"}).json()["code"] == 4002


def test_requisition_permissions():
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("10")
    c = _login_tester()
    # 使用者无审计权限 → 403
    assert c.post("/api/v1/requisitions/1/audit", json={"action": "approve"}).status_code == 403
    assert c.get("/api/v1/requisitions").status_code == 403  # 审计列表
    # 未登录 → 401
    assert TestClient(app).get("/api/v1/requisitions/my").status_code == 401
    # 使用者不能查看别人的申请 → 403（admin 先建一张）
    r = client.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "五车间", "use_reason": "admin 代建",
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    other_id = r.json()["data"]["id"]
    assert c.get(f"/api/v1/requisitions/{other_id}").status_code == 403
    # 本人可见
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "六车间", "use_reason": "本人申请",
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    assert c.get(f"/api/v1/requisitions/{r.json()['data']['id']}").status_code == 200


def test_notification_flow():
    _login_admin()
    c = _login_tester()
    # 未读数 + 已读标记
    cnt = c.get("/api/v1/notifications/unread-count").json()["data"]["unread_count"]
    assert cnt >= 1
    nid = c.get("/api/v1/notifications?is_read=0").json()["data"]["list"][0]["id"]
    assert c.put(f"/api/v1/notifications/{nid}/read").json()["code"] == 0
    after = c.get("/api/v1/notifications/unread-count").json()["data"]["unread_count"]
    assert after == cnt - 1
    # 全部已读
    assert c.put("/api/v1/notifications/read-all").json()["code"] == 0
    assert c.get("/api/v1/notifications/unread-count").json()["data"]["unread_count"] == 0
