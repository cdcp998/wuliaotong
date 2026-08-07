"""送货单 OCR 确认 + 入库关联 + 历史采购价测试（L2 门禁）。

覆盖：delivery/confirm 自动创建供应商（OCR+日期前缀编码）/同名复用/识别记录回写/无记录也返回；
入库单带 ocr_record_id 关联并回显；不存在的记录 4006；历史采购价按材料/供应商过滤。
"""
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _setup_wh_loc_product() -> tuple[int, int, int]:
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "WH" + tag, "name": "送货单仓"})
    assert r.json()["code"] == 0, r.text
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "A1"})
    shelf_id = r.json()["data"]["id"]
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": shelf_id, "layer_no": 1})
    loc_id = r.json()["data"]["id"]
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "9" + str(uuid.uuid4().int % 10**9), "name": "送货单材料", "unit_id": unit_id})
    assert r.json()["code"] == 0, r.text
    return wh_id, loc_id, r.json()["data"]["id"]


def _fake_record() -> int:
    """直接插入一条 OCR 识别记录（等价于 /ocr/recognize 落库）。"""
    from app.db import SessionLocal
    from app.models.ocr import OcrRecord

    db = SessionLocal()
    try:
        rec = OcrRecord(
            file_id=0, ocr_type=1, engine="rapidocr",
            raw_result=[{"text": "送货单"}], structured=None, match_status=2,
            duration_ms=0, user_id=1,
        )
        db.add(rec)
        db.commit()
        return rec.id
    finally:
        db.close()


def test_delivery_confirm_creates_supplier() -> None:
    _login_admin()
    # uuid 放开头：避免与历史测试残留的「送货单供应商…」供应商触发本地前缀归一（前 4 字一致）被误判复用
    name = uuid.uuid4().hex[:8] + "送货单供应商"
    r = client.post("/api/v1/ocr/delivery/confirm", json={
        "supplier_name": name,
        "bill_no": "PO2026TEST",
        "items": [{"product_name": "网络测试仪", "material_code": "114050000000310", "spec": "NF-918S", "qty": "1", "price": "350"}],
    })
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["supplier_name"] == name
    assert data["supplier_id"] > 0

    # 供应商已落库且编码为 OCR + 日期前缀（keyword 搜索：不走缓存、不受分页影响）
    lst = client.get(f"/api/v1/suppliers?keyword={name}").json()["data"]["list"]
    sup = next((s for s in lst if s["id"] == data["supplier_id"]), None)
    assert sup is not None
    assert sup["code"].startswith("OCR")
    assert sup["remark"] == "送货单 OCR 自动创建"

    # 同名复用：再次确认同一供应商名 → 返回相同 supplier_id
    r2 = client.post("/api/v1/ocr/delivery/confirm", json={
        "supplier_name": name,
        "items": [{"product_name": "X", "qty": "1", "price": "1"}],
    })
    assert r2.json()["code"] == 0, r2.text
    assert r2.json()["data"]["supplier_id"] == data["supplier_id"]


def test_delivery_confirm_updates_record() -> None:
    _login_admin()
    record_id = _fake_record()
    r = client.post("/api/v1/ocr/delivery/confirm", json={
        "record_id": record_id,
        "supplier_name": "记录供应商",
        "bill_no": "PO-REC",
        "items": [{"product_name": "测温仪", "spec": "H21", "qty": "2", "price": "2850"}],
    })
    assert r.json()["code"] == 0, r.text
    assert r.json()["data"]["record_id"] == record_id

    recs = client.get("/api/v1/ocr/records").json()["data"]["list"]
    rec = next((x for x in recs if x["id"] == record_id), None)
    assert rec is not None
    assert rec["structured"]["supplier_name"] == "记录供应商"
    assert rec["structured"]["bill_no"] == "PO-REC"
    assert rec["structured"]["items"][0]["spec"] == "H21"
    assert rec["match_status"] == 3

    # 不存在的记录 → 4003
    r = client.post("/api/v1/ocr/delivery/confirm", json={
        "record_id": 99999999,
        "items": [{"product_name": "X", "qty": "1", "price": "1"}],
    })
    assert r.json()["code"] == 4003, r.text


def test_purchase_in_with_ocr_record_and_history_price() -> None:
    _login_admin()
    wh_id, loc_id, pid = _setup_wh_loc_product()
    record_id = _fake_record()
    # 建供应商并确认送货单
    r = client.post("/api/v1/ocr/delivery/confirm", json={
        "record_id": record_id,
        "supplier_name": "历史价供应商" + uuid.uuid4().hex[:6],
        "bill_no": "PO-HIST",
        "items": [{"product_name": "送货单材料", "qty": "3", "price": "12.5"}],
    })
    sup_id = r.json()["data"]["supplier_id"]

    # 入库单关联 OCR 记录
    r = client.post("/api/v1/purchase-in", json={
        "supplier_id": sup_id,
        "warehouse_id": wh_id,
        "ocr_record_id": record_id,
        "remark": "送货单入库",
        "items": [{"product_id": pid, "qty": "3", "price": "12.5", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    bill_id = r.json()["data"]["id"]

    # 详情回显 ocr_record_id
    detail = client.get(f"/api/v1/purchase-in/{bill_id}").json()["data"]
    assert detail["ocr_record_id"] == record_id

    # 历史采购价：按材料
    r = client.get(f"/api/v1/purchase-in/history-price?product_id={pid}")
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["total"] >= 1
    row = data["list"][0]
    assert float(row["price"]) == 12.5
    assert row["supplier_name"]
    assert row["bill_no"]

    # 历史采购价：按材料 + 供应商过滤
    r = client.get(f"/api/v1/purchase-in/history-price?product_id={pid}&supplier_id={sup_id}")
    assert r.json()["data"]["total"] >= 1
    r = client.get(f"/api/v1/purchase-in/history-price?product_id={pid}&supplier_id=99999999")
    assert r.json()["data"]["total"] == 0

    # 不存在的材料 → 4003
    assert client.get("/api/v1/purchase-in/history-price?product_id=99999999").json()["code"] == 4003

    # 不存在的 OCR 记录关联 → 4006
    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id,
        "ocr_record_id": 99999999,
        "items": [{"product_id": pid, "qty": "1", "price": "1", "location_id": loc_id}],
    })
    assert r.json()["code"] == 4006, r.text


def test_confirm_auto_creates_missing_product() -> None:
    """确认转入入库时，系统不存在的物料自动新增（单位自动匹配/创建，返回 product_id）。"""
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    name = "自动新增物料" + tag
    r = client.post("/api/v1/ocr/delivery/confirm", json={
        "supplier_name": "自动建料供应商",
        "bill_no": "PO-AUTO",
        "items": [
            {"product_name": name, "material_code": "AUTO" + tag, "spec": "M8x30", "unit": "套", "qty": "3", "price": "12.5"},
        ],
    })
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    item = data["items"][0]
    assert item["product_id"] > 0 and item["_created"] is True
    assert data["created_products"] and data["created_products"][0]["product_id"] == item["product_id"]

    # 新物料已落库：编码/物料编码/规格/单位/进价（=识别单价）
    p = client.get(f"/api/v1/products/{item['product_id']}").json()["data"]
    assert p["name"] == name
    assert p["material_code"] == "AUTO" + tag
    assert p["spec"] == "M8x30"
    assert p["unit_name"] == "套"
    assert p["purchase_price"] == "12.50"
    assert p["remark"] == "送货单 OCR 自动创建"

    # 再次确认同名 → 匹配已存在（不再新建）
    r2 = client.post("/api/v1/ocr/delivery/confirm", json={
        "items": [{"product_name": name, "qty": "1", "price": "1"}],
    })
    item2 = r2.json()["data"]["items"][0]
    assert item2["product_id"] == item["product_id"]
    assert item2["_created"] is False
