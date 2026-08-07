"""材料-供应商关联测试（L2 门禁）。

覆盖：材料创建/编辑关联供应商、关联输出、重复关联去重、不存在的供应商 4006、
供应商详情查关联材料、删除保护（有启用材料关联禁止停用）、解除后删除并清理关联、
局部更新（状态切换）不清空关联。
"""
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _setup_supplier() -> int:
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/suppliers", json={"code": "SUP" + tag, "name": "关联供应商" + tag})
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["id"]


def _setup_product(supplier_ids: list[int] | None = None) -> int:
    tag = uuid.uuid4().hex[:6]
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    body: dict = {"code": "9" + str(uuid.uuid4().int % 10**9), "name": "关联材料" + tag, "unit_id": unit_id}
    if supplier_ids is not None:
        body["supplier_ids"] = supplier_ids
    r = client.post("/api/v1/products", json=body)
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["id"]


def test_product_supplier_link_crud() -> None:
    _login_admin()
    sid1 = _setup_supplier()
    sid2 = _setup_supplier()

    # 创建材料并关联两家供应商（含重复 id，应去重）
    pid = _setup_product([sid1, sid2, sid1])
    p = client.get(f"/api/v1/products/{pid}").json()["data"]
    assert sorted(p["supplier_ids"]) == sorted([sid1, sid2])
    assert len(p["supplier_names"]) == 2

    # 编辑：替换为仅 sid1
    r = client.put(f"/api/v1/products/{pid}", json={"name": p["name"], "unit_id": p["unit_id"], "supplier_ids": [sid1]})
    assert r.json()["code"] == 0, r.text
    p = client.get(f"/api/v1/products/{pid}").json()["data"]
    assert p["supplier_ids"] == [sid1]

    # 局部更新（状态切换，不传 supplier_ids）→ 关联保持
    r = client.put(f"/api/v1/products/{pid}", json={"name": p["name"], "unit_id": p["unit_id"], "status": 0})
    assert r.json()["code"] == 0, r.text
    p = client.get(f"/api/v1/products/{pid}").json()["data"]
    assert p["supplier_ids"] == [sid1]
    assert p["status"] == 0

    # 清空关联（传 []）
    r = client.put(f"/api/v1/products/{pid}", json={"name": p["name"], "unit_id": p["unit_id"], "supplier_ids": []})
    assert r.json()["code"] == 0, r.text
    assert client.get(f"/api/v1/products/{pid}").json()["data"]["supplier_ids"] == []

    # 关联不存在的供应商 → 4006
    r = client.put(f"/api/v1/products/{pid}", json={"name": p["name"], "unit_id": p["unit_id"], "supplier_ids": [99999999]})
    assert r.json()["code"] == 4006, r.text


def test_supplier_products_view() -> None:
    _login_admin()
    sid = _setup_supplier()
    pid1 = _setup_product([sid])
    pid2 = _setup_product([sid])

    r = client.get(f"/api/v1/suppliers/{sid}/products")
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["total"] == 2
    assert {p["id"] for p in data["list"]} == {pid1, pid2}

    # 不存在供应商 → 4003
    assert client.get("/api/v1/suppliers/99999999/products").json()["code"] == 4003


def test_supplier_delete_protection() -> None:
    _login_admin()
    sid = _setup_supplier()
    pid = _setup_product([sid])

    # 有启用材料关联 → 禁止删除
    r = client.delete(f"/api/v1/suppliers/{sid}")
    assert r.json()["code"] == 4006, r.text
    assert "启用材料" in r.json()["message"]

    # 材料停用后仍算残留 → 仍禁止（启用口径）
    tag = uuid.uuid4().hex[:6]
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.put(f"/api/v1/products/{pid}", json={"name": "x", "unit_id": unit_id, "status": 0})
    assert r.json()["code"] == 0, r.text
    r = client.delete(f"/api/v1/suppliers/{sid}")
    assert r.json()["code"] == 0, r.text  # 无启用材料关联 → 允许删除并清理关联
    assert client.get(f"/api/v1/suppliers/{sid}/products").json()["data"]["total"] == 0
    # 供应商已停用
    sup = [s for s in client.get("/api/v1/suppliers?status=0").json()["data"]["list"] if s["id"] == sid]
    assert sup and sup[0]["status"] == 0
