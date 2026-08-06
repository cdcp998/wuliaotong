"""商品编码纯数字 + 物料编码（公司系统编码）测试（本轮需求）。"""
from __future__ import annotations

import io
import random
import uuid

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]

COMPANY_HEADERS = [
    "序号", "材料用途", "材料大类", "材料分类", "物料编码", "材料名称",
    "型号规格", "单位", "数量", "用途", "用量(月/季/年）(仅导入使用)", "使用单位", "备注",
]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _make_unit() -> int:
    r = client.post("/api/v1/units", json={"name": "PC件" + uuid.uuid4().hex[:6]})
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["id"]


def test_product_code_must_be_numeric() -> None:
    _login_admin()
    unit = _make_unit()
    # 非纯数字 → 4006
    r = client.post("/api/v1/products", json={"code": "ABC123", "name": "非法编码", "unit_id": unit})
    assert r.json()["code"] == 4006
    # 纯数字 → 成功（随机唯一数字编码，避免测试库历史数据冲突）
    uniq = str(random.randint(10**7, 10**8))
    r = client.post("/api/v1/products", json={"code": uniq, "name": "数字编码", "unit_id": unit})
    assert r.json()["code"] == 0, r.text
    assert r.json()["data"]["code"] == uniq
    # 留空 → 自动生成纯数字（当前最大数字 + 1）
    r = client.post("/api/v1/products", json={"code": "", "name": "自动编码", "unit_id": unit})
    assert r.json()["code"] == 0, r.text
    auto = r.json()["data"]["code"]
    assert auto.isdigit() and int(auto) > int(uniq)


def test_product_material_code() -> None:
    _login_admin()
    unit = _make_unit()
    r = client.post("/api/v1/products", json={
        "code": "", "name": "带物料编码", "unit_id": unit,
        "material_code": "CM-2026-001",
    })
    assert r.json()["code"] == 0, r.text
    pid = r.json()["data"]["id"]
    out = client.get(f"/api/v1/products/{pid}").json()["data"]
    assert out["material_code"] == "CM-2026-001"
    # 更新物料编码
    r = client.put(f"/api/v1/products/{pid}", json={
        "code": "", "name": "带物料编码", "unit_id": unit, "material_code": "CM-2026-002",
    })
    assert r.json()["code"] == 0, r.text
    out = client.get(f"/api/v1/products/{pid}").json()["data"]
    assert out["material_code"] == "CM-2026-002" and out["code"]  # 编码留空保持原编码


def test_company_import_material_code_numeric_code() -> None:
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    material = f"MC{tag}01"
    wb = Workbook()
    ws = wb.active
    ws.append(COMPANY_HEADERS)
    ws.append([1, "维修", "机械件" + tag, "轴承类" + tag, material, "轴承6204", "6204-2RS", "个", 10, "", "", "", ""])
    # 第二行物料编码留空 → 验证 notice 提示管理员补充
    ws.append([2, "维修", "机械件" + tag, "轴承类" + tag, "", "无编码件", "N/A", "个", 1, "", "", "", ""])
    buf = io.BytesIO()
    wb.save(buf)
    r = client.post(
        "/api/v1/products/import",
        files={"file": ("company.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["success_count"] == 2
    # notice 包含物料编码补充提示（有行未填物料编码）
    assert "物料编码" in data["notice"]
    # 物料编码 → material_code；商品编码为自动纯数字
    rows = client.get(f"/api/v1/products?keyword={material}").json()["data"]["list"]
    assert len(rows) == 1
    p = rows[0]
    assert p["material_code"] == material
    assert p["code"].isdigit()
