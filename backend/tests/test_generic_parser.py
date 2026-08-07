"""通用字段提取（未知格式送货单）单元测试。

夹具为 `testdata/进货单/新格式进货单.JPG` 的真实 PaddleOCR 输出
（货物采购签收单：无物料编码列，列=货物名称/厂家品牌/规格型号/数量单价/金额/备注，
4 条明细，合计 84460.00，供应商「海口耐沃办公设备有限公司」）。
"""
from __future__ import annotations

from app.services.ocr.generic_parser import (
    is_footer_text,
    parse_delivery_generic,
    sanitize_items,
)

# (text, x0, y0, x1, y1)——PaddleOCR 坐标（真实识别结果）
NEW_FORMAT = [
    ("货物采购签收单", 2525, 938, 3394, 1090),
    ("同融沃办公设新所", 2128, 973, 2806, 1340),
    ("供货单位（盖章）：海口耐沃办公设备有限公司", 817, 1224, 2787, 1465),
    ("备注", 5126, 1330, 5324, 1452),
    ("金额", 4597, 1356, 4926, 1479),
    ("数量单价", 3822, 1367, 4443, 1520),
    ("规格型号", 3071, 1429, 3428, 1539),
    ("厂家品牌", 1979, 1453, 2423, 1592),
    ("DS-95", 5108, 1511, 5346, 1614),
    ("货物名称", 1075, 1523, 1466, 1650),
    ("100N-", 5140, 1611, 5368, 1708),
    ("38800.00", 4631, 1682, 4995, 1792),
    ("9700", 4237, 1706, 4443, 1811),
    ("HS24", 5158, 1709, 5361, 1807),
    ("杭州海康威视数字技", 1780, 1682, 2632, 1832),
    ("4", 3992, 1740, 4059, 1818),
    ("DS-8580N-KS24 R", 2939, 1761, 3632, 1864),
    ("R-V2", 5180, 1803, 5387, 1912),
    ("术股份有限公司/海康", 1758, 1787, 2661, 1937),
    ("容量型硬盘录", 959, 1852, 1543, 1995),
    ("威视", 2106, 1905, 2327, 2031),
    ("像机", 1134, 1968, 1359, 2100),
    ("21360.00", 4709, 2049, 5084, 2164),
    ("890", 4329, 2078, 4500, 2189),
    ("24", 4020, 2095, 4154, 2206),
    ("USR-W660", 3133, 2141, 3522, 2244),
    ("济南有人物联网技术", 1776, 2114, 2661, 2276),
    ("有限公司/有人", 1900, 2233, 2542, 2379),
    ("业无线WiFi 6", 930, 2251, 1544, 2396),
    ("8100.00", 4799, 2354, 5141, 2471),
    ("675", 4390, 2389, 4560, 2501),
    ("DS-2PT2144M", 3092, 2400, 3630, 2509),
    ("12", 4081, 2411, 4204, 2519),
    ("杭州海康威视数字技", 1775, 2376, 2677, 2546),
    ("W-DE(FIF1)", 3121, 2504, 3604, 2626),
    ("术股份有限公司/海", 1775, 2493, 2684, 2663),
    ("PTZ枪球一体机", 850, 2570, 1583, 2741),
    ("康威视", 2072, 2625, 2398, 2767),
    ("16200.00", 4863, 2728, 5259, 2858),
    ("1350", 4441, 2773, 4659, 2893),
    ("12", 4145, 2798, 4274, 2915),
    ("杭州海康威视数字技", 1768, 2773, 2704, 2956),
    ("DS-7916N-R4", 3140, 2907, 3699, 3031),
    ("术股份有限公司/海", 1767, 2896, 2711, 3082),
    ("84460.00", 4915, 2990, 5324, 3123),
    ("硬盘录像机", 941, 2989, 1468, 3153),
    ("康威视", 2073, 3039, 2415, 3193),
    ("大写：捌万肆仟肆佰陆拾元整", 1718, 3143, 3096, 3381),
    ("合计", 679, 3312, 916, 3460),
    ("验收单（签名）：", 661, 3435, 1521, 3627),
    ("月", 1916, 3572, 2064, 3729),
    ("货物验收日期：", 653, 3631, 1356, 3808),
    ("用户单位（盖章）：", 637, 3803, 1516, 4001),
]

LINES = [c[0] for c in NEW_FORMAT]
BOXES = [list(c[1:]) for c in NEW_FORMAT]


def test_new_format_full_parse():
    """未知格式（货物采购签收单）：4 条明细 + 供应商 + 金额自洽，合计行剔除。"""
    res = parse_delivery_generic(LINES, BOXES)
    assert res is not None
    assert res["supplier_name"] == "海口耐沃办公设备有限公司"
    assert len(res["items"]) == 4

    r1 = res["items"][0]
    assert r1["product_name"] == "容量型硬盘录像机"  # 碎片 容量型硬盘录 + 像机 合并
    assert r1["spec"] == "DS-8580N-KS24 R"
    assert (r1["qty"], r1["price"], r1["amount"]) == ("4", "9700", "38800")

    r2 = res["items"][1]
    assert r2["product_name"] == "业无线WiFi 6"
    assert (r2["qty"], r2["price"], r2["amount"]) == ("24", "890", "21360")

    r3 = res["items"][2]
    assert r3["product_name"] == "PTZ枪球一体机"
    assert r3["spec"] == "DS-2PT2144M W-DE(FIF1)"  # 英文碎片拼接补空格
    assert (r3["qty"], r3["price"], r3["amount"]) == ("12", "675", "8100")

    r4 = res["items"][3]
    assert r4["product_name"] == "硬盘录像机"
    assert r4["spec"] == "DS-7916N-R4"
    assert (r4["qty"], r4["amount"]) == ("12", "16200")

    # 合计行/大写金额/页脚不得成为明细
    names = [it["product_name"] for it in res["items"]]
    assert not any(("合计" in n or "大写" in n or "签收" in n or "验收" in n) for n in names)
    assert all(it["amount"] for it in res["items"])


def test_sanitize_items():
    """容错校验：剔无名称/表头行、qty 无效剔除、金额互推、异常值剔除。"""
    items, warns = sanitize_items([
        {"product_name": "合计", "qty": "4", "price": "9700", "amount": "38800"},
        {"product_name": "规格型号", "qty": "1", "price": "1", "amount": "1"},
        {"product_name": "", "qty": "2", "price": "3", "amount": "6"},
        {"product_name": "甲", "qty": "0", "price": "3", "amount": "6"},
        {"product_name": "乙", "qty": "2", "price": "3", "amount": ""},
        {"product_name": "丙", "qty": "999999999", "price": "3", "amount": "3"},
        {"product_name": "丁", "qty": "12", "price": "", "amount": "16200"},
    ])
    assert [it["product_name"] for it in items] == ["甲", "乙", "丁"]
    assert items[0]["qty"] == "2"  # qty=0 且价额齐全 → 金额÷单价反推
    assert items[1]["amount"] == "6"  # 缺失金额 = 数量×单价
    assert items[2]["price"] == "1350"  # 缺失单价 = 金额÷数量
    assert warns  # 含跳过提示


def test_fallback_no_box():
    """无坐标退化路径：仍能提取供应商（best-effort，不抛异常）。"""
    res = parse_delivery_generic(LINES, None)
    assert res is not None
    assert res["supplier_name"] == "海口耐沃办公设备有限公司"
    assert res["warnings"]


def test_is_footer_text():
    assert is_footer_text("合计")
    assert is_footer_text("大写：捌万肆仟肆佰陆拾元整")
    assert is_footer_text("货物名称")
    assert not is_footer_text("硬盘录像机")
    assert not is_footer_text("DS-8580N-KS24 R")
