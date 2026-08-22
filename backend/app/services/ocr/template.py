"""送货单模板解析（本地规则，无大模型）。

《后端API设计.md》§7：送货单固定版式（行号/物料编码/物料名称/规格型号/单位/数量/含税单价/价税合计）。
规则解析毫秒级完成，命中后不再调用大模型，减少等待；失败返回 None 由大模型兜底。

字段特征（对每行文本分类）：
- 物料编码：9~15 位纯数字（锚点，一条明细的开始；支持「编码 名称」同行）
- 名称：中文为主、不含数字/规格特征；排除「公司-」申报单位行
- 规格：以字母/数字开头且含字母（NF-918S、SG108P8L1、GO01、100mW、TL-、H21PROS+（A）
- 单位：单位词表（台/件/套/个/箱/只/根/包/米…）
- 数字：0 视为杂项跳过；数量（值最小，通常 <100）、单价/金额按出现顺序分配
"""
from __future__ import annotations

import re

_UNIT_WORDS = {"台", "件", "套", "个", "箱", "只", "根", "包", "米", "块", "条", "张", "对", "副", "瓶", "卷", "桶", "把", "支", "片", "组", "批"}

_NUM_RE = re.compile(r"^[0-9][0-9,]*\.?[0-9]*$")
_CODE_RE = re.compile(r"^(\d{9,15})(?:\s+(\S.*))?$")  # 编码锚点，支持同行名称
_SUPPLIER_RE = re.compile(r"供应商[:：]\s*(.+)")
_BILL_NO_RE = re.compile(r"(?:订单编号|单据编号|采购单号|订单号|送货单号)[:：]\s*(\S+)")
_SPEC_RE = re.compile(r"[A-Za-z]")
_THOUSAND_RE = re.compile(r"^\d{1,3},\d{3}(\.\d+)?$")  # 千分位 1,000.00
_DEC_COMMA_RE = re.compile(r"^\d+,\d{1,6}$")  # 逗号当小数点 175,000000 → 175.000000
_SUM_RE = re.compile(r"^合计")

# 送货单表头列名（PP-OCRv6 常把表头行与明细行混排，识别到这些词直接跳过）
_HEADER_WORDS = {
    "含税单价", "价税合计", "物料名称", "规格型号", "物料编码", "申报单位", "备注",
    "数量", "单价", "金额", "行号", "序号", "单位", "税率", "税额", "币种", "采购订单",
}


def _is_header_word(t: str) -> bool:
    return t in _HEADER_WORDS or any(w in t for w in ("行号", "序号", "物料编码", "规格型号"))


def _parse_num(t: str) -> float:
    if _THOUSAND_RE.match(t):
        return float(t.replace(",", ""))
    if _DEC_COMMA_RE.match(t):
        return float(t.replace(",", "."))
    return float(t.replace(",", ""))


def _fmt(v: float) -> str:
    """数字 → 字符串（去尾零，如 350.0 → 350、1.0000 → 1）。"""
    if v == int(v):
        return str(int(v))
    return format(v, "f").rstrip("0").rstrip(".")


def parse_delivery(lines: list[str]) -> dict | None:
    """规则模板解析送货单文本行；命中返回结构化 dict，否则 None。

    返回结构同大模型文本结构化：{"supplier_name", "bill_no", "items": [...]}（items 含 unit），
    另附 "_engine": "template" 供前端标注识别来源。
    """
    supplier_name = ""
    bill_no = ""
    items: list[dict] = []
    cur: dict | None = None
    nums: list[float] = []

    def _flush() -> None:
        nonlocal cur, nums
        if cur and cur.get("name"):
            vals = [x for x in nums if x > 0]  # 0 为备注/杂项列
            if vals:
                qty = min(vals)
                rest = [x for x in vals if x != qty] or []
                cur["qty"] = _fmt(qty)
                if rest:
                    price = rest[0]
                    cur["price"] = _fmt(price)
                if len(rest) >= 2:
                    # 金额优先取「单价×数量」匹配项（OCR 乱序时最稳），否则取最后出现
                    expect = round(qty * price, 2) if rest else None
                    amount = next((x for x in rest if round(x, 2) == expect), rest[-1])
                    cur["amount"] = _fmt(amount)
            items.append({
                "product_name": cur["name"],
                "material_code": cur["material_code"],
                "spec": cur["spec"],
                "unit": cur["unit"],
                "qty": cur["qty"],
                "price": cur["price"],
                "amount": cur["amount"],
            })
        cur = None
        nums = []

    for raw in lines:
        t = (raw or "").strip()
        if not t:
            continue
        m = _SUPPLIER_RE.match(t)
        if m:
            supplier_name = m.group(1).strip()
            continue
        m = _BILL_NO_RE.match(t)
        if m:
            bill_no = m.group(1).strip()
            continue
        if _SUM_RE.match(t):
            _flush()
            continue
        m = _CODE_RE.match(t)
        if m:  # 物料编码锚点：新明细开始（支持「编码 名称」同行）
            _flush()
            cur = {"material_code": m.group(1), "name": (m.group(2) or "").strip(), "spec": "", "unit": "", "qty": "", "price": "", "amount": ""}
            continue
        if cur is None:
            continue
        if _NUM_RE.match(t):
            v = _parse_num(t)
            if v > 0:
                if "." not in t and "," not in t and v <= 999:
                    continue  # 无小数点整数 = 行号/杂项列，跳过
                nums.append(v)
            continue
        if t in _UNIT_WORDS:
            cur["unit"] = t
            continue
        if _is_header_word(t):
            continue  # 表头列名（含税单价/申报单位等），PP-OCRv6 常将表头行混入明细，跳过
        # 规格：以字母/数字开头且含字母（NF-918S、100mW、H21PROS+（A）；排除中文开头的名称如「千兆POE交换机」
        if not cur["spec"] and re.match(r"^[A-Za-z0-9]", t) and _SPEC_RE.search(t) and len(t) <= 40:
            cur["spec"] = t
            continue
        # 规格续行：数字/符号开头或含 -+（）()（如「1）带微距」「功率65W」）；纯中文行不拼（可能是名称/单位名）
        if cur["spec"] and len(t) <= 20 and not t.startswith("公司-") and not _is_header_word(t) and (
            re.match(r"^[A-Za-z0-9（(]", t) or re.search(r"[-+（）()]", t)
        ):
            cur["spec"] += t
            continue
        if not cur["name"] and len(t) <= 30 and not t.startswith("公司-"):
            cur["name"] = t
    _flush()

    if not items and not supplier_name and not bill_no:
        return None
    return {
        "supplier_name": supplier_name,
        "bill_no": bill_no,
        "items": items,
        "_engine": "template",
    }
