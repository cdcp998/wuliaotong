"""条形码解码 + 条码唯一性 + 入库表头测试（L2 门禁）。

条形码图片用 zxing-cpp 生成（EAN13），走真实解码链路；
无条码图片验证 4006；条码唯一性覆盖创建/编辑/更新自身；
入库表头验证 supplier/bill_date/remark/operator 落库与回显。
"""
import io
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _upload_png(buf: bytes, name: str = "b.png") -> int:
    r = client.post("/api/v1/files/upload?biz_type=ocr", files={"file": (name, buf, "image/png")})
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["file_id"]


def _barcode_png(text: str = "6901234567892") -> bytes:
    """用 zxing-cpp 生成 EAN13 条码 PNG。"""
    import zxingcpp

    img = zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.EAN13, width=200, height=80).to_image()
    h, w = img.shape
    buf = io.BytesIO()
    Image.frombytes("L", (w, h), bytes(img)).save(buf, format="PNG")
    return buf.getvalue()


def _plain_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (200, 80), color=(240, 240, 240)).save(buf, format="PNG")
    return buf.getvalue()


def _setup_product(barcode: str = "") -> int:
    tag = uuid.uuid4().hex[:6]
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]  # 复用种子单位，不新建（防测试数据污染）
    r = client.post(
        "/api/v1/products",
        json={"code": "9" + str(uuid.uuid4().int % 10**9), "name": "条码材料" + tag, "unit_id": unit_id, "barcode": barcode},
    )
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["id"]


def _setup_wh_loc_product() -> tuple[int, int, int]:
    """建 仓库+货架+库位+商品，返回 (warehouse_id, location_id, product_id)。"""
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "WH" + tag, "name": "条码仓"})
    assert r.json()["code"] == 0, r.text
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "A1"})
    assert r.json()["code"] == 0, r.text
    shelf_id = r.json()["data"]["id"]
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": shelf_id, "layer_no": 1})
    assert r.json()["code"] == 0, r.text
    loc_id = r.json()["data"]["id"]
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "9" + str(uuid.uuid4().int % 10**9), "name": "表头材料", "unit_id": unit_id})
    assert r.json()["code"] == 0, r.text
    return wh_id, loc_id, r.json()["data"]["id"]


# ============================ 条码解码 ============================


def test_barcode_decode_ean13() -> None:
    _login_admin()
    file_id = _upload_png(_barcode_png("6901234567892"))
    r = client.post(f"/api/v1/barcode/decode?file_id={file_id}")
    assert r.json()["code"] == 0, r.text
    assert r.json()["data"]["barcode"] == "6901234567892"


def test_barcode_decode_no_barcode() -> None:
    _login_admin()
    file_id = _upload_png(_plain_png())
    r = client.post(f"/api/v1/barcode/decode?file_id={file_id}")
    assert r.json()["code"] == 4006, r.text


def test_barcode_decode_missing_file() -> None:
    _login_admin()
    assert client.post("/api/v1/barcode/decode?file_id=99999999").json()["code"] == 4003


def test_barcode_decode_permission() -> None:
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.status_code == 200 and r.json()["code"] == 0
    # 使用者无 ocr:use → 403
    assert c.post("/api/v1/barcode/decode?file_id=1").status_code == 403


# ============================ 条码唯一性 ============================


def test_barcode_unique_on_create_and_update() -> None:
    _login_admin()
    barcode = "69" + str(uuid.uuid4().int % 10**12)
    pid1 = _setup_product(barcode)

    # 创建重复条码 → 4006
    tag = uuid.uuid4().hex[:6]
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "9" + str(uuid.uuid4().int % 10**9), "name": "重复条码", "unit_id": unit_id, "barcode": barcode})
    assert r.json()["code"] == 4006, r.text
    assert "条码已存在" in r.json()["message"]

    # 编辑自身保持条码 → 允许
    p = client.get(f"/api/v1/products/{pid1}").json()["data"]
    r = client.put(f"/api/v1/products/{pid1}", json={"name": p["name"], "unit_id": p["unit_id"], "barcode": barcode})
    assert r.json()["code"] == 0, r.text

    # 编辑为他人已占用条码 → 4006
    r = client.put(f"/api/v1/products/{pid1}", json={"name": p["name"], "unit_id": p["unit_id"], "barcode": "69" + str(uuid.uuid4().int % 10**12)})
    assert r.json()["code"] == 0, r.text  # 先换到空闲条码
    pid2 = _setup_product(barcode)
    r = client.put(f"/api/v1/products/{pid1}", json={"name": p["name"], "unit_id": p["unit_id"], "barcode": barcode})
    assert r.json()["code"] == 4006, r.text


def test_barcode_optional_and_blank_stored_as_empty() -> None:
    _login_admin()
    pid = _setup_product()
    p = client.get(f"/api/v1/products/{pid}").json()["data"]
    assert p["barcode"] == ""


# ============================ 入库表头 ============================


def test_purchase_in_header_fields() -> None:
    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()
    # 建供应商
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/suppliers", json={"code": "SUP" + tag, "name": "表头供应商"})
    assert r.json()["code"] == 0, r.text
    sup_id = r.json()["data"]["id"]

    r = client.post("/api/v1/purchase-in", json={
        "supplier_id": sup_id,
        "warehouse_id": wh_id,
        "bill_date": "2026-08-08T10:30:00",
        "remark": "表头备注" + tag,
        "items": [{"product_id": pid, "qty": "3", "price": "4.5", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    bill_no = r.json()["data"]["bill_no"]
    bill_id = r.json()["data"]["id"]

    lst = client.get("/api/v1/purchase-in?bill_no=" + bill_no).json()["data"]
    assert lst["total"] >= 1
    detail = client.get(f"/api/v1/purchase-in/{bill_id}").json()["data"]
    assert detail["supplier_name"] == "表头供应商"
    assert detail["remark"] == "表头备注" + tag
    assert detail["bill_date"].startswith("2026-08-08")
    assert detail["operator_name"]  # 经办人回显
    assert float(detail["total_qty"]) == 3  # Numeric(12,3) 尾零如 '3.000'
    assert float(detail["total_amount"]) == 13.5
