"""公司系统表头兼容导入测试（商品导入识别公司 13 列模板）。"""
import io
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


def _make_xlsx(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(COMPANY_HEADERS)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_product_import_company_template():
    _login_admin()
    tag = _TAG
    big_cat, sub_cat = f"机械件{tag}", f"轴承类{tag}"  # 唯一分类名，避免历史同名分类干扰
    xlsx = _make_xlsx([
        [1, "维修", big_cat, sub_cat, f"CM{tag}01", "深沟球轴承", "6204-2RS", "个", 10, "设备维修", "月", "三车间", "进口件"],
        [2, "维修", big_cat, sub_cat, "", "", "6205", "个", 5, "", "", "二车间", ""],  # 编码/名称为空 → 失败行
    ])
    r = client.post(
        "/api/v1/products/import",
        files={"file": ("company.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["success_count"] == 1
    assert data["fail_rows"] and data["fail_rows"][0]["row"] == 3

    # 商品字段映射正确
    rows = client.get(f"/api/v1/products?keyword=CM{tag}01").json()["data"]["list"]
    assert len(rows) == 1
    p = rows[0]
    assert p["name"] == "深沟球轴承" and p["spec"] == "6204-2RS" and p["remark"] == "进口件"
    assert p["unit_name"] == "个"  # 单位自动创建
    # 条形码为本系统内部使用：物料编码（公司）≠ 条码；导入自动生成 13 位 EAN-13
    assert p["barcode"] != f"CM{tag}01"
    assert len(p["barcode"]) == 13 and p["barcode"].isdigit()
    # 分类两级自动创建：材料大类(一级) → 材料分类(二级)
    cats = client.get("/api/v1/categories").json()["data"]
    big = next((c for c in cats if c["name"] == big_cat), None)
    assert big is not None and big["parent_id"] == 0
    # 二级分类挂在顶级分类的 children 里（categories 返回树结构）
    assert any(c["name"] == sub_cat and c["parent_id"] == big["id"] for c in big.get("children", []))
    # 商品挂在二级分类下
    assert p["category_name"] == sub_cat
