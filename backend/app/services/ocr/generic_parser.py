"""送货单通用字段提取（未知格式回退解析，纯本地规则、无大模型消耗）。

适用：不属于固定模板版式（services/ocr/template.py 未命中）、无 9~15 位物料编码锚点的
新格式送货单，如「货物采购签收单」（列：货物名称/厂家品牌/规格型号/数量单价/金额/备注）。

核心思路（利用 OCR 行坐标，Paddle/RapidOCR 均返回 box）：
1. 全文正则提取 供应商/单号（与版式无关）；
2. 表头行（货物名称/厂家品牌/规格型号/数量/单价/金额 等表头词）→ 列原型与列角色
   （名称/品牌/规格/编码/单位/数量/单价/金额/数量单价/备注）；
3. 数字列按 y 聚类成「数字行」（表格行锚点），行内按列分配 qty/price/amount，
   「数量单价」合列按 x 分裂，qty×price≈amount 一致性校验；
4. 名称/品牌/规格等文本列内碎片（同单元格断行）先合并，再按「列斜线校正」后的
   y 坐标就近归入数字行（校正斜率由表头行线性回归估计，抗照片倾斜/透视）；
5. 合计行（合计/总计/大写金额）与无名称行剔除。
box 缺失时退化为行文本启发式拆分（不同引擎兜底）。

sanitize_items()：所有识别来源（模板/通用/视觉/DeepSeek）共用的容错校验——
剔除表头词/合计词/无名称行、qty 非正数或超界剔除、price/amount 缺失互推、
数值归一去尾零、金额与 qty×price 偏差过大记 warning（保留单据原值）。
"""
from __future__ import annotations

import re

_NUM_RE = re.compile(r"^[0-9][0-9,]*\.?[0-9]*$")
_THOUSAND_RE = re.compile(r"^\d{1,3},\d{3}(\.\d+)?$")  # 千分位 1,000.00
_DEC_COMMA_RE = re.compile(r"^\d+,\d{1,6}$")  # 逗号当小数点 175,000000 → 175.000000

# 表头词（整词匹配列名）；含这些词的单元格不参与明细
HEADER_WORDS = {
    "货物名称", "品名", "物料名称", "商品名称", "产品名称", "名称", "厂家品牌", "品牌", "厂商",
    "生产厂家", "规格型号", "规格", "型号", "数量", "单价", "金额", "数量单价", "数量金额",
    "含税单价", "价税合计", "合计金额", "单位", "申报单位", "备注", "行号", "序号", "税额",
    "税率", "币种", "物料编码", "编码", "采购订单", "订单编号", "单据编号", "送货单号",
    "物料编号", "货号", "产地",
}

# 页脚/合计词：含这些词的行不是商品明细
_FOOTER_WORDS = ("合计", "总计", "共", "大写", "小写", "验收", "日期", "盖章", "签名", "经办", "审核", "开单", "收货", "供货单位", "供应商", "电话", "地址", "备注", "金额", "数量", "单价", "名称", "单位", "规格", "品牌", "编码", "序号", "行号")

_SUPPLIER_RES = [
    re.compile(r"(?:供货单位|供应商|供方|供货方|销售方|卖方|开票单位|收款单位|客户单位|购货单位)[（(]?\s*盖章\s*[)）]?\s*[:：]?\s*([^\s，,。；;|]{2,60})"),
    re.compile(r"(?:供货单位|供应商|供方|供货方|销售方|卖方|开票单位|收款单位|客户单位|购货单位)\s*[:：]\s*([^\s，,。；;|]{2,60})"),
]
_BILL_NO_RES = [
    re.compile(r"(?:送货单号|单据编号|单据号|订单编号|采购单号|采购订单号|订单号|合同编号|合同号|编号|单号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-/_]{2,39})"),
]
# 大写金额行（如 大写：捌万肆仟肆佰陆拾元整）→ 页脚，不作明细
_CAPITAL_RE = re.compile(r"大写[:：]?\s*[零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]+")

_UNIT_WORDS = {"台", "件", "套", "个", "箱", "只", "根", "包", "米", "块", "条", "张", "对", "副", "瓶", "卷", "桶", "把", "支", "片", "组", "批"}

# 列角色
ROLE_NAME, ROLE_BRAND, ROLE_SPEC, ROLE_CODE, ROLE_UNIT = "name", "brand", "spec", "code", "unit"
ROLE_QTY, ROLE_PRICE, ROLE_AMOUNT, ROLE_QP = "qty", "price", "amount", "qp"  # qp=数量单价合列
ROLE_REMARK, ROLE_OTHER = "remark", "other"
_NUM_ROLES = {ROLE_QTY, ROLE_PRICE, ROLE_AMOUNT, ROLE_QP}


def _box_bounds(box) -> tuple[float, float, float, float] | None:
    """box → (x0, y0, x1, y1)。兼容 4 点坐标 [[x,y]×4]（含 Paddle 的 numpy 数组）与 (x0,y0,x1,y1) 两种形式。"""
    if not box:
        return None
    try:
        if len(box) == 4 and all(hasattr(p, "__getitem__") and len(p) >= 2 for p in box):
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            return min(xs), min(ys), max(xs), max(ys)
        if len(box) == 4:
            x0, y0, x1, y1 = (float(v) for v in box)
            return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)
    except (TypeError, ValueError):
        return None
    return None


def _is_number(t: str) -> bool:
    return bool(_NUM_RE.match(t.strip()))


def _parse_num(t: str) -> float | None:
    t = t.strip().replace(" ", "")
    if not _NUM_RE.match(t):
        return None
    try:
        if _THOUSAND_RE.match(t):
            return float(t.replace(",", ""))
        if _DEC_COMMA_RE.match(t):
            return float(t.replace(",", "."))
        return float(t.replace(",", ""))
    except ValueError:
        return None


def _fmt_num(v: float) -> str:
    """数字 → 字符串（去尾零，如 350.0 → 350、1.0000 → 1）。"""
    if v == int(v):
        return str(int(v))
    return format(v, "f").rstrip("0").rstrip(".")


def _role_of_header(text: str) -> str:
    t = text.strip()
    if not t:
        return ROLE_OTHER
    if t in ("数量单价", "数量金额") or ("数量" in t and "单价" in t):
        return ROLE_QP
    if "金额" in t or "价税合计" in t:
        return ROLE_AMOUNT
    if "单价" in t:
        return ROLE_PRICE
    if "数量" in t:
        return ROLE_QTY
    if "规格" in t or "型号" in t:
        return ROLE_SPEC
    if "品牌" in t or "厂家" in t or "厂商" in t:
        return ROLE_BRAND
    if "编码" in t or "货号" in t:
        return ROLE_CODE
    if "单位" in t:
        return ROLE_UNIT
    if "名称" in t or "品名" in t:
        return ROLE_NAME
    if "备注" in t:
        return ROLE_REMARK
    return ROLE_OTHER


def is_footer_text(text: str) -> bool:
    """页脚/表头/合计类文本判断（防脏数据落库：确认链路与明细清洗共用）。"""
    t = (text or "").strip()
    if not t:
        return True
    if _CAPITAL_RE.match(t):
        return True
    if t in HEADER_WORDS:
        return True
    return any(w in t for w in _FOOTER_WORDS)


def _extract_header_fields(texts: list[str]) -> tuple[str, str]:
    """全文提取 供应商/单号（与版式无关）。"""
    supplier, bill_no = "", ""
    for t in texts:
        if not supplier:
            for rx in _SUPPLIER_RES:
                m = rx.search(t)
                if m:
                    v = m.group(1).strip().rstrip("：:").strip()
                    if 2 <= len(v) <= 60:
                        supplier = v
                        break
        if not bill_no:
            for rx in _BILL_NO_RES:
                m = rx.search(t)
                if m:
                    bill_no = m.group(1).strip()
                    break
        if supplier and bill_no:
            break
    return supplier, bill_no


def _estimate_slope(pts: list[tuple[float, float]]) -> float:
    """y ≈ a + b·x 线性回归斜率（表格行随照片倾斜/透视的列斜线校正）。"""
    if len(pts) < 3:
        return 0.0
    n = len(pts)
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts)
    sxy = sum(p[0] * p[1] for p in pts)
    denom = n * sxx - sx * sx
    if abs(denom) < 1e-9:
        return 0.0
    return (n * sxy - sx * sy) / denom


def parse_delivery_generic(lines: list[str], boxes: list | None = None) -> dict | None:
    """通用字段提取送货单文本行（含坐标）；命中返回 dict，否则 None。

    返回结构同 DeepSeek：{"supplier_name", "bill_no", "items": [...]}（items 含 unit），
    另附 "warnings"（容错提示）。调用方负责 sanitize_items 与 _engine 标注。
    """
    supplier_name, bill_no = _extract_header_fields(lines)
    texts = [(t or "").strip() for t in lines]
    if boxes is None:
        return _fallback_text_parse(texts, supplier_name, bill_no)
    cells: list[dict] = []
    for i, t in enumerate(texts):
        if not t:
            continue
        b = _box_bounds(boxes[i]) if i < len(boxes) else None
        if b is None:
            continue  # 个别行无有效坐标：跳过该行，不整体退化（避免误入文本启发式）
        x0, y0, x1, y1 = b
        cells.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "xc": (x0 + x1) / 2, "yc": (y0 + y1) / 2, "text": t})
    if len(cells) < 6:
        return None

    # ---- 列原型：表头词所在单元格 → 列区间 + 角色 ----
    # 整词表头，或短文本命中表头子串（如「含税单价」被 OCR 拆行识别）
    header_cells = [
        c for c in cells
        if c["text"] in HEADER_WORDS
        or (len(c["text"]) <= 8 and any(w in c["text"] for w in HEADER_WORDS))
    ]
    if len(header_cells) < 3:
        # 无清晰表头 → 按列角色推断的启发式（见 _columns_from_clusters）
        header_cells = [c for c in cells if c["text"] in HEADER_WORDS]
    if not header_cells:
        return _fallback_text_parse(texts, supplier_name, bill_no)

    header_cells.sort(key=lambda c: c["xc"])
    cols: list[dict] = []
    for c in header_cells:
        role = _role_of_header(c["text"])
        pad = max(6.0, (c["x1"] - c["x0"]) * 0.15)
        cols.append({
            "x0": c["x0"] - pad, "x1": c["x1"] + pad,
            "xc": (c["x0"] + c["x1"]) / 2,
            "role": role, "label": c["text"], "hy": c["yc"],
        })
    # 相邻表头列去重（同一列两个表头词如「数量单价」被拆两行识别）
    merged_cols: list[dict] = []
    for col in cols:
        if merged_cols and col["xc"] <= merged_cols[-1]["x1"]:
            prev = merged_cols[-1]
            prev["x1"] = max(prev["x1"], col["x1"])
            prev["x0"] = min(prev["x0"], col["x0"])
            if prev["role"] == ROLE_OTHER and col["role"] != ROLE_OTHER:
                prev["role"] = col["role"]
            elif prev["role"] != col["role"] and col["role"] != ROLE_OTHER:
                # 数量 与 单价 相邻合并 → 视为合列
                if {prev["role"], col["role"]} <= {ROLE_QTY, ROLE_PRICE}:
                    prev["role"] = ROLE_QP
            prev["label"] += "/" + col["label"]
        else:
            merged_cols.append(col)
    cols = merged_cols

    def col_of(cell: dict) -> dict | None:
        """单元格 → 列。纯数字优先数字列（防金额漂移进备注）；否则最大重叠/最近。"""
        num = _is_number(cell["text"])
        num_cols = [c for c in cols if c["role"] in _NUM_ROLES]
        cand = [c for c in cols if c["x0"] - 4 <= cell["xc"] <= c["x1"] + 4]
        if num and num_cols:
            cand = [c for c in cand if c["role"] in _NUM_ROLES] or [c for c in cols if c["role"] in _NUM_ROLES]
        if not cand:
            cand = cols
        return max(cand, key=lambda c: (max(0.0, min(cell["x1"], c["x1"]) - max(cell["x0"], c["x0"])), -abs(cell["xc"] - (c["x0"] + c["x1"]) / 2)))

    # ---- 数字行锚点：数字列单元格按 y 聚类 ----
    num_cells = [dict(c, col=col_of(c)) for c in cells if _is_number(c["text"]) and col_of(c)["role"] in _NUM_ROLES]
    if not num_cells:
        return _fallback_text_parse(texts, supplier_name, bill_no)
    heights = [c["y1"] - c["y0"] for c in cells]
    med_h = sorted(heights)[len(heights) // 2] if heights else 100.0
    slope = _estimate_slope([(c["xc"], c["yc"]) for c in header_cells])
    x_ref = sum(c["xc"] for c in num_cells) / len(num_cells)
    for c in num_cells:
        c["yc2"] = c["yc"] - slope * (c["xc"] - x_ref)
    num_cells.sort(key=lambda c: c["yc2"])

    rows: list[list[dict]] = []
    gap_th = max(1.0 * med_h, 30.0)
    for c in num_cells:
        if rows and c["yc2"] - rows[-1][-1]["yc2"] <= gap_th:
            rows[-1].append(c)
        else:
            rows.append([c])

    # 密集表格（行距 < 阈值被并组）时按 qty×price≈amount 重切
    rows = _resplit_dense_rows(rows, gap_th)

    # ---- 文本列碎片合并（同单元格断行，仅非数字列） ----
    text_cols = [c for c in cols if c["role"] not in _NUM_ROLES and c["role"] != ROLE_OTHER]
    frags: dict[tuple, list[dict]] = {}
    for c in cells:
        col = col_of(c)
        if col["role"] not in (ROLE_NAME, ROLE_BRAND, ROLE_SPEC, ROLE_CODE, ROLE_UNIT, ROLE_REMARK):
            continue
        if c["text"] in HEADER_WORDS:
            continue
        key = (col["x0"], col["x1"], col["role"])
        frags.setdefault(key, []).append(dict(c, col=col))
    merged_text: list[dict] = []
    for key, frag_list in frags.items():
        frag_list.sort(key=lambda c: c["yc"])
        cur = frag_list[0]
        for f in frag_list[1:]:
            if f["y0"] <= cur["y1"] + 0.35 * med_h and max(f["x0"], cur["x0"]) <= min(f["x1"], cur["x1"]) + 8:
                cur["y1"] = max(cur["y1"], f["y1"])
                cur["x1"] = max(cur["x1"], f["x1"])
                cur["x0"] = min(cur["x0"], f["x0"])
                if cur["text"] and f["text"] and cur["text"][-1] == f["text"][0]:
                    cur["text"] += f["text"][1:]
                elif cur["text"] and f["text"] and cur["text"][-1].isascii() and cur["text"][-1].isalnum() and f["text"][0].isascii() and f["text"][0].isalnum():
                    cur["text"] += " " + f["text"]  # 英文碎片拼接补空格（DS-2PT2144M + W-DE(FIF1)）
                else:
                    cur["text"] += f["text"]
                cur["yc"] = (cur["y0"] + cur["y1"]) / 2
                cur["xc"] = (cur["x0"] + cur["x1"]) / 2
            else:
                merged_text.append(cur)
                cur = f
        merged_text.append(cur)
    for c in merged_text:
        c["yc2"] = c["yc"] - slope * (c["xc"] - x_ref)

    # ---- 文本归行：就近数字行（窗口 = 0.45 × 行距） ----
    row_ys = [sum(c["yc2"] for c in r) / len(r) for r in rows]
    pitch = 0.0
    if len(row_ys) >= 2:
        pitch = (row_ys[-1] - row_ys[0]) / (len(row_ys) - 1)
    window = max(0.45 * pitch, 1.2 * med_h) if pitch else 2.2 * med_h

    def nearest_row(cell: dict) -> int | None:
        best, bd = -1, float("inf")
        for i, ry in enumerate(row_ys):
            d = abs(cell["yc2"] - ry)
            if d < bd:
                best, bd = i, d
        return best if bd <= window else None

    row_text: list[dict] = [{} for _ in rows]
    for c in merged_text:
        idx = nearest_row(c)
        if idx is None:
            continue
        role = c["col"]["role"]
        if role == ROLE_REMARK:
            continue
        prev = row_text[idx].get(role)
        row_text[idx][role] = c["text"] if not prev else f"{prev}{c['text']}"

    # ---- 组装明细 ----
    items: list[dict] = []
    for i, r in enumerate(rows):
        qty = price = amount = ""
        qp_cells = sorted([c for c in r if c["col"]["role"] == ROLE_QP], key=lambda c: c["xc"])
        for c in r:
            role = c["col"]["role"]
            if role == ROLE_QTY and not qty:
                qty = _fmt_num(_parse_num(c["text"]) or 0)
            elif role == ROLE_PRICE and not price:
                price = _fmt_num(_parse_num(c["text"]) or 0)
            elif role == ROLE_AMOUNT and not amount:
                amount = _fmt_num(_parse_num(c["text"]) or 0)
        if qp_cells:  # 数量单价合列：左=数量，右=单价
            left = qp_cells[0]
            qty = _fmt_num(_parse_num(left["text"]) or 0)
            if len(qp_cells) >= 2:
                price = _fmt_num(_parse_num(qp_cells[1]["text"]) or 0)
        # 一致性：qty×price≈amount 不成立且对调可行 → 对调（防列序错位）
        qv, pv, av = _parse_num(qty), _parse_num(price), _parse_num(amount)
        if qv and pv and av and qv * pv > 0 and abs(qv * pv - av) / max(av, 1e-9) > 0.02 and pv and qv != pv:
            if abs(pv * qv - av) / max(av, 1e-9) <= 0.02:
                qty, price = price, qty
        name = (row_text[i].get(ROLE_NAME) or "").strip()
        if not name:
            continue  # 无名称行（含合计行）剔除
        if is_footer_text(name):
            continue
        items.append({
            "product_name": name,
            "material_code": (row_text[i].get(ROLE_CODE) or "").strip(),
            "spec": (row_text[i].get(ROLE_SPEC) or "").strip(),
            "unit": (row_text[i].get(ROLE_UNIT) or "").strip(),
            "qty": qty,
            "price": price,
            "amount": amount,
        })

    if not items and not supplier_name and not bill_no:
        return None
    return {"supplier_name": supplier_name, "bill_no": bill_no, "items": items, "warnings": []}


def _resplit_dense_rows(rows: list[list[dict]], gap_th: float) -> list[list[dict]]:
    """密集表格行并组时，按 (数量, 单价, 金额) 三元组一致性重切。"""
    out: list[list[dict]] = []
    for r in rows:
        if len(r) <= 3:
            out.append(r)
            continue
        sub: list[list[dict]] = []
        cur: list[dict] = []
        for c in sorted(r, key=lambda c: c["yc2"]):
            cur.append(c)
            roles = {c["col"]["role"] for c in cur}
            has_am = ROLE_AMOUNT in roles
            has_qp = any(c["col"]["role"] == ROLE_QP for c in cur)
            if len(cur) >= 3 and has_am and (has_qp or {ROLE_QTY, ROLE_PRICE} <= roles):
                sub.append(cur)
                cur = []
        if cur:
            sub.append(cur)
        out.extend(sub if len(sub) > 1 else [r])
    return out


def _fallback_text_parse(texts: list[str], supplier_name: str, bill_no: str) -> dict | None:
    """无坐标退化：行文本启发式——供应商/单号正则 + 中文名+行尾数字拆分。

    仅作保险（Paddle/RapidOCR 均返回坐标，正常不触发）。
    """
    items: list[dict] = []
    for t in texts:
        t = t.strip()
        if not t or t in HEADER_WORDS or is_footer_text(t):
            continue
        m = re.match(r"^(.*?)\s+([0-9][0-9,]*\.?[0-9]*)(?:\s+([0-9][0-9,]*\.?[0-9]*))?(?:\s+([0-9][0-9,]*\.?[0-9]*))?$", t)
        if not m or len(m.group(1)) < 2:
            continue
        name = m.group(1).strip()
        if is_footer_text(name):
            continue
        nums = [g for g in m.groups()[1:] if g]
        it = {"product_name": name, "material_code": "", "spec": "", "unit": "", "qty": "", "price": "", "amount": ""}
        if len(nums) >= 1:
            it["qty"] = _fmt_num(_parse_num(nums[0]) or 0)
        if len(nums) >= 2:
            it["price"] = _fmt_num(_parse_num(nums[1]) or 0)
        if len(nums) >= 3:
            it["amount"] = _fmt_num(_parse_num(nums[2]) or 0)
        items.append(it)
    if not items and not supplier_name and not bill_no:
        return None
    return {"supplier_name": supplier_name, "bill_no": bill_no, "items": items, "warnings": ["未获取文字坐标，使用行文本启发式解析，请人工核对"]}


def sanitize_items(items: list) -> tuple[list[dict], list[str]]:
    """容错校验（所有识别来源通用）：剔表头/合计/无名称行、qty 非正数或超界、
    price/amount 缺失互推、数值归一去尾零、金额一致性记 warning。"""
    out: list[dict] = []
    warnings: list[str] = []
    for raw in items:
        it = dict(raw) if isinstance(raw, dict) else {}
        name = str(it.get("product_name") or "").strip()
        if not name:
            warnings.append("跳过无名称明细行")
            continue
        if is_footer_text(name):
            warnings.append(f"跳过非明细行：{name[:20]}")
            continue
        qty = _parse_num(str(it.get("qty") or ""))
        price = _parse_num(str(it.get("price") or ""))
        amount = _parse_num(str(it.get("amount") or ""))
        if qty is not None and qty > 0 and price and amount and qty * price > 0 and abs(qty * price - amount) / max(amount, 1e-9) > 0.02:
            warnings.append(f"「{name[:20]}」金额与数量×单价不一致（按单据原值保留，请人工核对）")
        if qty is not None and qty <= 0:
            if price and amount and price > 0:
                qty = amount / price  # qty=0 且价额齐全 → 反推数量
            else:
                warnings.append(f"跳过「{name[:20]}」：数量无效")
                continue
        if qty is not None and qty > 10**6:
            warnings.append(f"跳过「{name[:20]}」：数量超出合理范围")
            continue
        if price is not None and price > 10**9:
            warnings.append(f"跳过「{name[:20]}」：单价超出合理范围")
            continue
        if qty is None and price and amount and price > 0:
            qty = amount / price
        if price is None and qty and amount and qty > 0:
            price = amount / qty
        if amount is None and qty and price:
            amount = qty * price
        spec = str(it.get("spec") or "").strip()
        if spec and is_footer_text(spec):
            spec = ""
        unit = str(it.get("unit") or "").strip()
        if unit and (len(unit) > 8 or not (unit in _UNIT_WORDS or unit.isalpha())):
            unit = ""
        out.append({
            "product_name": name,
            "material_code": str(it.get("material_code") or "").strip(),
            "spec": spec,
            "unit": unit,
            "qty": _fmt_num(qty) if qty is not None else "",
            "price": _fmt_num(price) if price is not None else "",
            "amount": _fmt_num(amount) if amount is not None else "",
        })
    return out, warnings
