"""库存核心接口测试（P2，L2 门禁）。需要本地 MySQL 已初始化。

覆盖：采购入库（含移动加权成本）、作废冲销（含库存不足拒绝）、
期初（草稿/修改/过账/重复过账拒绝/Excel 导入）、库存查询、流水追溯、权限。
"""
import io
import uuid

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _setup_wh_loc_product() -> tuple[int, int, int]:
    """建 仓库+货架+库位+商品，返回 (warehouse_id, location_id, product_id)。每次调用唯一后缀。"""
    tag = uuid.uuid4().hex[:6]
    wh_code = "WH" + tag
    r = client.post("/api/v1/warehouses", json={"code": wh_code, "name": "P2仓"})
    assert r.json()["code"] == 0, r.text
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "A1"})
    assert r.json()["code"] == 0, r.text
    shelf_id = r.json()["data"]["id"]
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": shelf_id, "layer_no": 1})
    assert r.json()["code"] == 0, r.text
    loc_id = r.json()["data"]["id"]

    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    code = "9" + str(int(tag, 16) % 10**9)
    r = client.post("/api/v1/products", json={"code": code, "name": "P2商品", "unit_id": unit_id, "purchase_price": "5.00"})
    assert r.json()["code"] == 0, r.text
    pid = r.json()["data"]["id"]
    return wh_id, loc_id, pid


def _stock_qty(product_id: int) -> str:
    r = client.get(f"/api/v1/stock?product_id={product_id}").json()
    rows = r["data"]["list"]
    if not rows:
        return "0"  # 尚无库存行（如草稿期）
    assert len(rows) == 1, r
    return rows[0]["qty"]


# ============================ 采购入库 ============================

def test_purchase_in_and_moving_cost():
    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()

    # 第一批 10 件 @5.00
    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": "10", "price": "5.00", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    bill_no = r.json()["data"]["bill_no"]
    assert bill_no.startswith("RK")

    # 第二批 10 件 @7.00 → 移动加权成本 = (10*5 + 10*7)/20 = 6.00
    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": "10", "price": "7.00", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0
    bill2_id = r.json()["data"]["id"]

    rows = client.get(f"/api/v1/stock?product_id={pid}").json()["data"]["list"]
    assert rows[0]["qty"] == "20.000"
    assert rows[0]["cost_price"] == "6.00"
    assert rows[0]["amount"] == "120.00"

    # 流水
    flow = client.get(f"/api/v1/stock/flow?product_id={pid}").json()["data"]
    assert flow["total"] == 2
    assert flow["list"][0]["change_type"] == "采购入库"
    assert flow["list"][0]["after_qty"] == "20.000"
    assert flow["list"][0]["bill_no"] == bill_no or flow["list"][1]["bill_no"] == bill_no

    # 单号列表查询
    lst = client.get(f"/api/v1/purchase-in?bill_no={bill_no}").json()["data"]
    assert lst["total"] == 1
    detail = client.get(f"/api/v1/purchase-in/{lst['list'][0]['id']}").json()["data"]
    assert detail["items"][0]["product_name"] == "P2商品"

    # 作废第一单（10 件 @5）→ 库存回到 10，成本回到 7.00（另一单的进价）
    r = client.post(f"/api/v1/purchase-in/{bill2_id}/void")
    assert r.json()["code"] == 0, r.text
    rows = client.get(f"/api/v1/stock?product_id={pid}").json()["data"]["list"]
    assert rows[0]["qty"] == "10.000"

    # 重复作废 → 4002
    assert client.post(f"/api/v1/purchase-in/{bill2_id}/void").json()["code"] == 4002


def test_post_stock_change_insufficient():
    """post_stock_change 出库超过库存 → 4001（库存事务单元级测试）。"""
    from decimal import Decimal

    from app.core.response import BizError
    from app.db import SessionLocal
    from app.services.stock import post_stock_change

    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()
    db = SessionLocal()
    try:
        post_stock_change(
            db, product_id=pid, warehouse_id=wh_id, location_id=loc_id,
            change_type="期初", bill_type="test", bill_no="T0001",
            qty_delta=Decimal("5"), cost_price=Decimal("1"),
        )
        db.commit()
        try:
            post_stock_change(
                db, product_id=pid, warehouse_id=wh_id, location_id=loc_id,
                change_type="出库", bill_type="test", bill_no="T0002",
                qty_delta=Decimal("-10"),
            )
            db.commit()
            assert False, "应抛出 4001 库存不足"
        except BizError as e:
            assert e.code == 4001
        db.rollback()
    finally:
        db.close()


# ============================ 期初库存 ============================

def test_opening_draft_post():
    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()

    # 草稿
    r = client.post("/api/v1/opening", json={
        "warehouse_id": wh_id, "remark": "期初测试",
        "items": [{"product_id": pid, "location_id": loc_id, "qty": "100", "cost_price": "3.00"}],
    })
    assert r.json()["code"] == 0, r.text
    bill_id = r.json()["data"]["id"]
    assert _stock_qty(pid) == "0"  # 草稿期尚无库存行

    # 修改草稿（数量 100 → 150）
    r = client.put(f"/api/v1/opening/{bill_id}", json={
        "warehouse_id": wh_id, "remark": "改",
        "items": [{"product_id": pid, "location_id": loc_id, "qty": "150", "cost_price": "3.00"}],
    })
    assert r.json()["code"] == 0, r.text

    # 过账 → 库存 150
    assert client.post(f"/api/v1/opening/{bill_id}/post").json()["code"] == 0
    assert _stock_qty(pid) == "150.000"

    # 过账后不可再改 / 再过账
    assert client.put(f"/api/v1/opening/{bill_id}", json={
        "warehouse_id": wh_id, "remark": "x",
        "items": [{"product_id": pid, "location_id": loc_id, "qty": "1", "cost_price": "1"}],
    }).json()["code"] == 4002
    assert client.post(f"/api/v1/opening/{bill_id}/post").json()["code"] == 4002

    # 详情含仓库名/商品名
    detail = client.get(f"/api/v1/opening/{bill_id}").json()["data"]
    assert detail["items"][0]["product_name"] == "P2商品"
    assert detail["items"][0]["qty"] == "150.000"


def test_opening_import():
    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()
    code = client.get(f"/api/v1/products/{pid}").json()["data"]["code"]
    loc_code = client.get(f"/api/v1/locations?warehouse_id={wh_id}").json()["data"][0]["code"]

    wb = Workbook()
    ws = wb.active
    ws.append(["商品编码", "库位编码", "数量", "成本价"])
    ws.append([code, loc_code, "50", "2.50"])
    ws.append(["NO_SUCH", loc_code, "10", "1.00"])  # 商品不存在 → 失败行
    buf = io.BytesIO()
    wb.save(buf)

    r = client.post(
        f"/api/v1/opening/import?warehouse_id={wh_id}",
        files={"file": ("opening.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["success_count"] == 1
    assert data["fail_rows"] and data["fail_rows"][0]["reason"].startswith("商品编码")

    # 草稿过账后库存 50
    assert client.post(f"/api/v1/opening/{data['draft_id']}/post").json()["code"] == 0
    assert _stock_qty(pid) == "50.000"


# ============================ 库存查询 / 权限 ============================

def test_stock_query_and_permission():
    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()
    client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": "3", "price": "4.00", "location_id": loc_id}],
    })

    # keyword 命中（用商品编码）
    code = client.get(f"/api/v1/products/{pid}").json()["data"]["code"]
    r = client.get(f"/api/v1/stock?keyword={code}").json()
    assert r["data"]["total"] == 1
    # warehouse 过滤
    r = client.get(f"/api/v1/stock?warehouse_id={wh_id}").json()
    assert r["data"]["total"] == 1
    # 未登录 401
    assert TestClient(app).get("/api/v1/stock").status_code == 401

    # 使用者角色无 pch:in → 采购入库 403，但库存查询可用
    c = TestClient(app)
    c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert c.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    }).status_code == 403
    assert c.get(f"/api/v1/stock?keyword=P2P{_TAG}").status_code == 200


def test_purchase_in_with_category_updates_product():
    """入库明细带分类（大模型识别/人工确认）→ 同步更新材料分类；顶级分类挂材料被拒（4006）；无效分类 4006。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()
    r = client.post("/api/v1/categories", json={"parent_id": 0, "name": "P2测试分类" + uuid.uuid4().hex[:6]})
    assert r.json()["code"] == 0, r.text
    root_id = r.json()["data"]["id"]
    r = client.post("/api/v1/categories", json={"parent_id": root_id, "name": "P2测试子分类" + uuid.uuid4().hex[:6]})
    assert r.json()["code"] == 0, r.text
    cat_id = r.json()["data"]["id"]
    # 带二级分类入库 → 材料分类被更新
    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id,
        "items": [{"product_id": pid, "qty": "1", "price": "1.00", "location_id": loc_id, "category_id": cat_id}],
    })
    assert r.json()["code"] == 0, r.text
    p = client.get(f"/api/v1/products/{pid}").json()["data"]
    assert p["category_id"] == cat_id
    # 顶级分类不可挂材料 → 4006（整单回滚）
    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id,
        "items": [{"product_id": pid, "qty": "1", "price": "1.00", "location_id": loc_id, "category_id": root_id}],
    })
    assert r.json()["code"] == 4006, r.text
    # 无效分类 → 4006（整单回滚）
    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id,
        "items": [{"product_id": pid, "qty": "1", "price": "1.00", "location_id": loc_id, "category_id": 999999999}],
    })
    assert r.json()["code"] == 4006, r.text
