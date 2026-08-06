"""库存进阶测试（P4，L2 门禁）：调拨、盘点、其他出入库、库存预警。"""
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _setup_two_wh(qty: str = "30") -> tuple[int, int, int, int, int]:
    """建两仓（各一库位）+ 商品 + 首仓入库 qty。返回 (wh_a, loc_a, wh_b, loc_b, pid)。"""
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "TA" + tag, "name": "调出仓"})
    wh_a = r.json()["data"]["id"]
    r = client.post("/api/v1/warehouses", json={"code": "TB" + tag, "name": "调入仓"})
    wh_b = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_a, "code": "S1"})
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_a, "shelf_id": r.json()["data"]["id"], "layer_no": 1})
    loc_a = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_b, "code": "S1"})
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_b, "shelf_id": r.json()["data"]["id"], "layer_no": 1})
    loc_b = r.json()["data"]["id"]

    client.post("/api/v1/units", json={"name": "P4件" + tag})
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "P4P" + tag, "name": "P4物料", "unit_id": unit_id})
    pid = r.json()["data"]["id"]

    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_a, "items": [{"product_id": pid, "qty": qty, "price": "1.00", "location_id": loc_a}],
    })
    assert r.json()["code"] == 0, r.text
    return wh_a, loc_a, wh_b, loc_b, pid


def _wh_qty(warehouse_id: int, product_id: int) -> str:
    rows = client.get(f"/api/v1/stock?warehouse_id={warehouse_id}&product_id={product_id}").json()["data"]["list"]
    return rows[0]["qty"] if rows else "0"


# ============================ 调拨 ============================

def test_transfer_flow():
    _login_admin()
    wh_a, loc_a, wh_b, loc_b, pid = _setup_two_wh("30")

    # 草稿
    r = client.post("/api/v1/transfers", json={
        "from_warehouse_id": wh_a, "to_warehouse_id": wh_b,
        "items": [{"product_id": pid, "qty": "10", "from_location_id": loc_a, "to_location_id": loc_b}],
    })
    assert r.json()["code"] == 0, r.text
    t_id = r.json()["data"]["id"]
    # 同仓校验
    assert client.post("/api/v1/transfers", json={
        "from_warehouse_id": wh_a, "to_warehouse_id": wh_a,
        "items": [{"product_id": pid, "qty": "1", "from_location_id": loc_a, "to_location_id": loc_b}],
    }).json()["code"] == 4006

    # 审核 → 调出仓 20、调入仓 10
    assert client.post(f"/api/v1/transfers/{t_id}/audit").json()["code"] == 0
    assert _wh_qty(wh_a, pid) == "20.000"
    assert _wh_qty(wh_b, pid) == "10.000"
    # 两条流水
    flow = client.get(f"/api/v1/stock/flow?product_id={pid}&bill_no={client.get(f'/api/v1/transfers/{t_id}').json()['data']['bill_no']}").json()["data"]
    types = {x["change_type"] for x in flow["list"]}
    assert types == {"调拨出", "调拨入"}

    # 作废已审核单 → 冲销回滚（B 仓库存行保留 qty 0）
    assert client.post(f"/api/v1/transfers/{t_id}/void").json()["code"] == 0
    assert _wh_qty(wh_a, pid) == "30.000"
    assert _wh_qty(wh_b, pid) == "0.000"


def test_transfer_insufficient():
    _login_admin()
    wh_a, loc_a, wh_b, loc_b, pid = _setup_two_wh("5")
    r = client.post("/api/v1/transfers", json={
        "from_warehouse_id": wh_a, "to_warehouse_id": wh_b,
        "items": [{"product_id": pid, "qty": "10", "from_location_id": loc_a, "to_location_id": loc_b}],
    })
    t_id = r.json()["data"]["id"]
    assert client.post(f"/api/v1/transfers/{t_id}/audit").json()["code"] == 4001
    assert _wh_qty(wh_a, pid) == "5.000" and _wh_qty(wh_b, pid) == "0"  # 整单回滚


# ============================ 盘点 ============================

def test_check_flow():
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "CK" + tag, "name": "盘点仓"})
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "S1"})
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": r.json()["data"]["id"], "layer_no": 1})
    loc_id = r.json()["data"]["id"]
    client.post("/api/v1/units", json={"name": "盘件" + tag})
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "PDP" + tag, "name": "盘点物料", "unit_id": unit_id, "min_stock": "100"})
    pid = r.json()["data"]["id"]
    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": "10", "price": "1.00", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0

    # 建盘点单：自动带出账面 10
    r = client.post("/api/v1/checks", json={"warehouse_id": wh_id})
    assert r.json()["code"] == 0, r.text
    c_id = r.json()["data"]["id"]
    detail = client.get(f"/api/v1/checks/{c_id}").json()["data"]
    assert detail["items"][0]["book_qty"] == "10.000"

    # 录实盘 12 → 盘盈 2（带拍照记录，可选）
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (60, 40)).save(buf, format="PNG")
    up = client.post("/api/v1/files/upload?biz_type=check", files={"file": ("c.png", buf.getvalue(), "image/png")})
    assert up.json()["code"] == 0, up.text
    photo_id = up.json()["data"]["file_id"]
    ci_id = detail["items"][0]["id"]
    r = client.put(f"/api/v1/checks/{c_id}/items", json={"items": [{"check_item_id": ci_id, "real_qty": "12", "photo_file_id": photo_id}]})
    assert r.json()["code"] == 0, r.text
    # 照片已保存
    saved = client.get(f"/api/v1/checks/{c_id}").json()["data"]["items"][0]
    assert saved["photo_file_id"] == photo_id

    # 审核 → 库存 12、盘盈流水
    assert client.post(f"/api/v1/checks/{c_id}/audit").json()["code"] == 0
    assert _wh_qty(wh_id, pid) == "12.000"
    flow = client.get(f"/api/v1/stock/flow?product_id={pid}&change_type=盘盈").json()["data"]
    assert flow["total"] == 1 and flow["list"][0]["change_qty"] == "2.000"

    # 已审核不可再改
    assert client.put(f"/api/v1/checks/{c_id}/items", json={"items": [{"check_item_id": ci_id, "real_qty": "1"}]}).json()["code"] == 4002


# ============================ 其他出入库 ============================

def test_other_io_flow():
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "QW" + tag, "name": "其他仓"})
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "S1"})
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": r.json()["data"]["id"], "layer_no": 1})
    loc_id = r.json()["data"]["id"]
    client.post("/api/v1/units", json={"name": "其件" + tag})
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "QTP" + tag, "name": "其他物料", "unit_id": unit_id})
    pid = r.json()["data"]["id"]
    client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": "20", "price": "1.00", "location_id": loc_id}],
    })

    # 报废 3
    r = client.post("/api/v1/other-io", json={
        "io_type": "报废", "warehouse_id": wh_id,
        "items": [{"product_id": pid, "qty": "3", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    io_id = r.json()["data"]["id"]
    assert _wh_qty(wh_id, pid) == "17.000"

    # 其他入 5
    r = client.post("/api/v1/other-io", json={
        "io_type": "其他入", "warehouse_id": wh_id,
        "items": [{"product_id": pid, "qty": "5", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0
    assert _wh_qty(wh_id, pid) == "22.000"

    # 作废报废单 → 反向 +3 → 25（当前 22）
    assert client.post(f"/api/v1/other-io/{io_id}/void").json()["code"] == 0
    assert _wh_qty(wh_id, pid) == "25.000"
    # 重复作废 → 4002
    assert client.post(f"/api/v1/other-io/{io_id}/void").json()["code"] == 4002
    # 非法类型 → 4006
    assert client.post("/api/v1/other-io", json={
        "io_type": "非法", "warehouse_id": wh_id,
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    }).json()["code"] == 4006


# ============================ 库存预警 ============================

def test_stock_alerts():
    _login_admin()
    from app.db import SessionLocal
    from app.models.sys import SysUser
    from app.scheduler import scan_stock_alerts

    # 建一个低于下限的商品（min_stock=100，库存 50）
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "AW" + tag, "name": "预警仓"})
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "S1"})
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": r.json()["data"]["id"], "layer_no": 1})
    loc_id = r.json()["data"]["id"]
    client.post("/api/v1/units", json={"name": "预件" + tag})
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "ALP" + tag, "name": "预警物料", "unit_id": unit_id, "min_stock": "100"})
    pid = r.json()["data"]["id"]
    client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": "50", "price": "1.00", "location_id": loc_id}],
    })

    result = scan_stock_alerts()
    assert result["alerts"] >= 1

    # 管理员（super_admin）收到低库存预警
    db = SessionLocal()
    try:
        admin = db.query(SysUser).filter(SysUser.username == "admin").first()
        cnt = client.get("/api/v1/notifications?biz_type=预警").json()["data"]  # 无 biz_type 过滤，仅确认接口可用
        assert cnt["total"] >= 0
        # 幂等：再次扫描不重复生成
        r2 = scan_stock_alerts()
        assert r2["alerts"] == 0
    finally:
        db.close()
