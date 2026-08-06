"""基础资料接口测试（P1，L2 门禁）。需要本地 MySQL 已初始化。

幂等性：所有编码/名称带随机后缀，可重复执行。
"""
import io
import uuid

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.core.security import hash_password
from app.db import SessionLocal
from app.main import app
from app.models.sys import SysUser

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]  # 本次运行的唯一后缀


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _make_xlsx(headers: list[str], rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ============================ 分类 ============================

def test_category_tree_crud():
    _login_admin()
    tag = "类" + _TAG
    r = client.post("/api/v1/categories", json={"name": tag})
    assert r.json()["code"] == 0, r.text
    root_id = r.json()["data"]["id"]
    r = client.post("/api/v1/categories", json={"parent_id": root_id, "name": tag + "子"})
    child_id = r.json()["data"]["id"]
    assert r.json()["code"] == 0

    tree = client.get("/api/v1/categories").json()["data"]
    root = [n for n in tree if n["id"] == root_id][0]
    assert root["children"][0]["id"] == child_id

    r = client.put(f"/api/v1/categories/{root_id}", json={"name": tag + "改", "parent_id": 0})
    assert r.json()["code"] == 0

    # 有子分类不能删
    assert client.delete(f"/api/v1/categories/{root_id}").json()["code"] == 4006
    # 删子分类成功
    assert client.delete(f"/api/v1/categories/{child_id}").json()["code"] == 0
    assert client.delete(f"/api/v1/categories/{root_id}").json()["code"] == 0


# ============================ 单位 ============================

def test_unit_crud():
    _login_admin()
    tag = "件" + _TAG
    r = client.post("/api/v1/units", json={"name": tag})
    assert r.json()["code"] == 0, r.text
    unit_id = r.json()["data"]["id"]
    # 重名拦截
    assert client.post("/api/v1/units", json={"name": tag}).json()["code"] == 4006
    r = client.put(f"/api/v1/units/{unit_id}", json={"name": tag + "改"})
    assert r.json()["code"] == 0
    assert client.delete(f"/api/v1/units/{unit_id}").json()["code"] == 0


# ============================ 供应商 ============================

def test_supplier_crud_and_import():
    _login_admin()
    code = "SUP" + _TAG
    r = client.post("/api/v1/suppliers", json={"code": code, "name": "华东五金"})
    assert r.json()["code"] == 0, r.text
    sup_id = r.json()["data"]["id"]
    assert client.post("/api/v1/suppliers", json={"code": code, "name": "重复"}).json()["code"] == 4006
    r = client.put(f"/api/v1/suppliers/{sup_id}", json={"code": code, "name": "华东五金批发"})
    assert r.json()["code"] == 0
    # 软删除（status=0）
    assert client.delete(f"/api/v1/suppliers/{sup_id}").json()["code"] == 0

    xlsx = _make_xlsx(["编码", "名称", "联系人", "电话", "地址"], [
        ["SUP2" + _TAG, "南方轴承", "王五", "13800000000", "苏州"],
        ["", "无名供应商", "", "", ""],
    ])
    r = client.post(
        "/api/v1/suppliers/import",
        files={"file": ("suppliers.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.json()["code"] == 0
    data = r.json()["data"]
    assert data["success_count"] == 2 and data["fail_rows"] == []


# ============================ 仓库/货架/库位 ============================

def test_warehouse_shelf_location_crud():
    _login_admin()
    wh_code = "CK" + _TAG
    r = client.post("/api/v1/warehouses", json={"code": wh_code, "name": "一号仓库"})
    assert r.json()["code"] == 0, r.text
    wh_id = r.json()["data"]["id"]
    assert client.post("/api/v1/warehouses", json={"code": wh_code, "name": "重复"}).json()["code"] == 4006

    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "J01", "name": "货架一"})
    assert r.json()["code"] == 0, r.text
    shelf_id = r.json()["data"]["id"]

    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": shelf_id, "layer_no": 1})
    assert r.json()["code"] == 0, r.text
    loc = r.json()["data"]
    assert loc["code"] == f"{wh_code}-J01-01"  # 自动生成库位编码

    locs = client.get(f"/api/v1/locations?warehouse_id={wh_id}").json()["data"]
    assert len(locs) == 1
    # 有货架不能删仓库
    assert client.delete(f"/api/v1/warehouses/{wh_id}").json()["code"] == 4006
    assert client.delete(f"/api/v1/locations/{loc['id']}").json()["code"] == 0
    assert client.delete(f"/api/v1/shelves/{shelf_id}").json()["code"] == 0
    assert client.delete(f"/api/v1/warehouses/{wh_id}").json()["code"] == 0


# ============================ 商品 ============================

def test_product_crud():
    _login_admin()
    unit_name = "箱" + _TAG
    client.post("/api/v1/units", json={"name": unit_name})
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]

    code = "P1" + _TAG
    payload = {
        "code": code, "barcode": "6900000000001", "sku": "SKU-1", "name": "轴承6204",
        "spec": "20x12", "unit_id": unit_id, "purchase_price": "8.50",
        "min_stock": "10", "max_stock": "500",
        "units": [{"unit_id": unit_id, "rate": "1", "is_default": 1}],
    }
    r = client.post("/api/v1/products", json=payload)
    assert r.json()["code"] == 0, r.text
    pid = r.json()["data"]["id"]
    assert r.json()["data"]["purchase_price"] == "8.50"

    # 编码重复
    assert client.post("/api/v1/products", json={**payload, "code": code}).json()["code"] == 4006

    # 搜索
    r = client.get(f"/api/v1/products?keyword={code}").json()
    assert r["data"]["total"] == 1
    r = client.get("/api/v1/products?barcode=6900000000001").json()
    assert r["data"]["total"] >= 1

    # 修改
    r = client.put(f"/api/v1/products/{pid}", json={**payload, "name": "轴承6204-2RS"})
    assert r.json()["code"] == 0, r.text
    assert client.get(f"/api/v1/products/{pid}").json()["data"]["name"] == "轴承6204-2RS"

    # 软删除
    assert client.delete(f"/api/v1/products/{pid}").json()["code"] == 0
    r = client.get(f"/api/v1/products?keyword={code}").json()
    assert r["data"]["total"] == 0


def test_product_import_export():
    _login_admin()
    unit_name = "盒" + _TAG
    cat_name = "标准件" + _TAG
    xlsx = _make_xlsx(
        ["编码", "条码", "SKU", "名称", "分类", "规格", "单位", "进价", "下限", "上限"],
        [
            ["P2" + _TAG, "6900000000002", "", "螺丝M6", cat_name, "30mm", unit_name, "2.50", "100", "5000"],
            ["P3" + _TAG, "", "", "", cat_name, "", unit_name, "1.00", "0", "0"],  # 名称为空 → 失败行
        ],
    )
    r = client.post(
        "/api/v1/products/import",
        files={"file": ("products.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["success_count"] == 1 and data["fail_rows"] and data["fail_rows"][0]["row"] == 3

    # 导入的分类/单位自动创建
    cats = client.get("/api/v1/categories").json()["data"]
    assert any(c["name"] == cat_name for c in cats)

    # 模板
    r = client.get("/api/v1/products/import-template")
    assert r.status_code == 200 and "spreadsheet" in r.headers["content-type"]

    # 导出
    r = client.get("/api/v1/products/export")
    assert r.status_code == 200 and "spreadsheet" in r.headers["content-type"]
    wb = __import__("openpyxl").load_workbook(io.BytesIO(r.content))
    rows = list(wb.active.iter_rows(values_only=True))
    assert len(rows) >= 2  # 表头 + 至少 1 行


# ============================ 权限校验 ============================

def test_permission_denied():
    # 新建一个"使用者"角色账号（无 base:product 写权限）
    db = SessionLocal()
    try:
        if not db.query(SysUser).filter(SysUser.username == "tester_user").first():
            db.add(SysUser(username="tester_user", password_hash=hash_password("123456"), real_name="测试使用者", role_id=4))
            db.commit()
    finally:
        db.close()

    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.json()["code"] == 0
    # 无 base:product 写权限 → 403；查询对所有登录用户开放（领用选商品需要）
    assert c.post("/api/v1/products", json={"code": "X1", "name": "x", "unit_id": 1}).status_code == 403
    assert c.get("/api/v1/products").status_code == 200
    # 未登录 → 401
    assert TestClient(app).get("/api/v1/products").status_code == 401
