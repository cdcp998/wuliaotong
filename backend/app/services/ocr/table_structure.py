"""SLANet_plus 表格结构 + PP-OCRv6 单元格文字 + 坐标后处理对齐。

流程：
1. PPStructureV3（SLANet_plus 表格结构 + PP-OCRv6 文本模型）识别图片，
   取得 table_ocr_pred（单元格内文字 + 坐标）与 cell_box_list（单元格定位）；
2. 不直接信任 SLANet_plus 的 HTML 行列，改用 PP-OCRv6 坐标：
   - 表头词拟合行斜率（抗倾斜）；
   - 按校正后 y 聚行、按 x 聚列；
3. 表头识别 + 数据行锚点（行号+物料编码）+ 多行单元格碎片合并；
4. 按表头列名映射为送货单结构化结果（供应商/单号/明细）。
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path

import numpy as np

from app.services.ocr.client import OCRInitError

# PP-OCR/PaddleX 模型缓存根目录：backend/model（与 paddleocr_api 保持一致）
MODEL_DIR = Path(__file__).resolve().parents[3] / "model"

# 文本模型版本 → PP-OCRv6 检测/识别模型名
_OCR_MODEL_NAMES: dict[str, dict[str, str]] = {
    "PP-OCRv6": {"det": "PP-OCRv6_medium_det", "rec": "PP-OCRv6_medium_rec"},
}

# 表头提示词：用于拟合行斜率与识别表头行（兼容采购订单 / 新格式送货单）
_HEADER_HINTS = (
    "货物名称", "品名", "物料名称", "商品名称", "产品名称", "名称",
    "厂家品牌", "厂家", "品牌", "厂商", "生产厂家",
    "规格型号", "规格", "型号",
    "数量", "单价", "金额", "数量单价", "数量金额", "含税单价", "价税合计",
    "单位", "备注", "申报单位", "物料编码", "行号", "序号",
)


def _header_role(text: str) -> str:
    """表头文本 → 列角色。"""
    t = text
    if "数量" in t and "单价" in t:
        return "qp"
    if "金额" in t or "价税合计" in t:
        return "amount"
    if "单价" in t:
        return "price"
    if "数量" in t:
        return "qty"
    if "规格" in t or "型号" in t:
        return "spec"
    if "品牌" in t or "厂家" in t or "厂商" in t:
        return "brand"
    if "编码" in t or "货号" in t:
        return "code"
    if "单位" in t:
        return "unit"
    if "名称" in t or "品名" in t:
        return "name"
    if "行号" in t or "序号" in t:
        return "row"
    if "备注" in t:
        return "remark"
    return "other"


def _split_qp(items: list[dict]) -> tuple[str, str]:
    """拆分「数量单价」合列：按 x 左=数量、右=单价。"""
    nums = [l for l in items if re.search(r"\d", l["text"])]
    if not nums:
        return "", ""
    nums_sorted = sorted(nums, key=lambda l: l["cx"])
    if len(nums_sorted) == 1:
        return _first_number(nums_sorted[0]["text"]), ""
    mid = (nums_sorted[0]["cx"] + nums_sorted[-1]["cx"]) / 2.0
    left = [l for l in nums_sorted if l["cx"] <= mid]
    right = [l for l in nums_sorted if l["cx"] > mid]
    return (
        _first_number(" ".join(l["text"] for l in left)),
        _first_number(" ".join(l["text"] for l in right)),
    )


def _fit_slope(points: list[tuple[float, float]]) -> float:
    """y ≈ a + b·x 线性回归斜率。"""
    if len(points) < 3:
        return 0.0
    n = len(points)
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    denom = n * sxx - sx * sx
    if abs(denom) < 1e-9:
        return 0.0
    return (n * sxy - sx * sy) / denom


def _cluster_1d(items: list[dict], axis: str, tol: float) -> list[list[dict]]:
    """按一维坐标聚类（axis: cx/cy/cy2）。返回有序分组。"""
    groups: list[list[dict]] = []
    for it in sorted(items, key=lambda x: x[axis]):
        placed = False
        for g in groups:
            lo = min(x[axis] for x in g)
            hi = max(x[axis] for x in g)
            if it[axis] <= hi + tol and it[axis] >= lo - tol:
                g.append(it)
                placed = True
                break
        if not placed:
            groups.append([it])
    groups.sort(key=lambda g: min(x[axis] for x in g))
    return groups


def _first_number(text: str) -> str:
    m = re.search(r"\d+(?:\.\d+)?", text.replace(",", ""))
    if not m:
        return ""
    num = m.group(0)
    if "." in num:
        num = num.rstrip("0").rstrip(".")
    return num


def _clean_name(text: str) -> str:
    """去除中文之间的空格（如「网络视频监控测 试仪」→「网络视频监控测试仪」）。"""
    return re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text).strip()


class PaddleTableStructureEngine:
    """本地表格结构识别引擎：SLANet_plus 结构 + PP-OCRv6 单元格文字 + 坐标对齐。"""

    name = "paddle_table_structure"

    def __init__(self, model_version: str = "PP-OCRv6") -> None:
        self.model_version = model_version
        self._pipeline = None
        self._lock = threading.Lock()

    def _ensure_init(self):
        if self._pipeline is None:
            with self._lock:
                if self._pipeline is None:
                    # 模型目录固定 backend/model，必须在导入 paddleocr 前设置
                    os.makedirs(MODEL_DIR, exist_ok=True)
                    os.environ["PADDLE_PDX_CACHE_HOME"] = str(MODEL_DIR)
                    try:
                        from paddleocr import PPStructureV3  # noqa: PLC0415
                    except ImportError as e:
                        raise OCRInitError(
                            "表格结构识别需要 PaddleOCR（PP-StructureV3）。请运行："
                            "backend/.venv/Scripts/python.exe backend/scripts/setup_ppocr.py 自动安装"
                        ) from e
                    models = _OCR_MODEL_NAMES.get(self.model_version, _OCR_MODEL_NAMES["PP-OCRv6"])
                    try:
                        self._pipeline = PPStructureV3(
                            use_doc_orientation_classify=False,
                            use_doc_unwarping=False,
                            use_textline_orientation=False,
                            use_seal_recognition=False,
                            use_table_recognition=True,
                            use_formula_recognition=False,
                            use_chart_recognition=False,
                            use_region_detection=False,
                            text_detection_model_name=models["det"],
                            text_recognition_model_name=models["rec"],
                        )
                    except Exception as e:  # noqa: BLE001
                        raise OCRInitError(f"表格结构识别初始化失败：{e}") from e
        return self._pipeline

    def recognize(self, image_bytes: bytes) -> dict:
        """识别送货单图片，返回结构化结果。

        返回：{"supplier_name", "bill_no", "items": [...]}
        items 字段：product_name/material_code/spec/unit/qty/price/amount/remark。
        """
        pipeline = self._ensure_init()
        import io
        import tempfile

        try:
            from PIL import Image

            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            # PaddleX 传 numpy 数组与传文件路径的识别结果有差异；统一走临时文件，保证稳定
            fd, tmp_path = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            try:
                img.save(tmp_path, format="PNG")
                results = pipeline.predict(tmp_path)
            finally:
                os.remove(tmp_path)
        except OCRInitError:
            raise
        except Exception as e:
            raise OCRInitError(f"表格结构识别失败：{e}") from e

        if not results:
            return {"supplier_name": "", "bill_no": "", "items": []}
        page = results[0]
        table_list = (page or {}).get("table_res_list") or []
        if not table_list:
            return {"supplier_name": "", "bill_no": "", "items": []}
        tr = table_list[0]
        ocr = tr.get("table_ocr_pred") or {}
        _rec_texts = ocr.get("rec_texts")
        _rec_polys = ocr.get("rec_polys")
        texts = [str(t) for t in (_rec_texts if _rec_texts is not None else [])]
        polys = [np.asarray(p, dtype=float).tolist() for p in (_rec_polys if _rec_polys is not None else [])]

        lines: list[dict] = []
        for i, t in enumerate(texts):
            poly = polys[i] if i < len(polys) else []
            if not poly or not t:
                continue
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            lines.append({
                "i": i,
                "text": str(t).strip(),
                "cx": (min(xs) + max(xs)) / 2.0,
                "cy": (min(ys) + max(ys)) / 2.0,
                "h": max(ys) - min(ys),
                "w": max(xs) - min(xs),
            })
        if not lines:
            return {"supplier_name": "", "bill_no": "", "items": []}

        # 行斜率校正：表头词拟合 y≈a+b·x
        header_pts = [l for l in lines if any(w in l["text"] for w in _HEADER_HINTS)]
        slope = _fit_slope([(l["cx"], l["cy"]) for l in header_pts])
        x_ref = sum(l["cx"] for l in lines) / len(lines)
        for l in lines:
            l["cy2"] = l["cy"] - slope * (l["cx"] - x_ref)

        heights = sorted(l["h"] for l in lines)
        widths = sorted(l["w"] for l in lines)
        med_h = heights[len(heights) // 2] if heights else 10.0
        med_w = widths[len(widths) // 2] if widths else 10.0

        row_groups = _cluster_1d(lines, "cy2", max(2.0, med_h * 0.4))
        row_of: dict[int, int] = {}
        for ri, g in enumerate(row_groups):
            for l in g:
                row_of[l["i"]] = ri

        # 表头行：含表头词最多的行
        def header_score(ri: int) -> int:
            return sum(1 for w in _HEADER_HINTS if w in " ".join(l["text"] for l in row_groups[ri]))

        header_idx = max(range(len(row_groups)), key=header_score)
        header_lines = row_groups[header_idx]

        # 先按全局 x 聚类建一份网格，判断是否“采购订单强锚点”（行号+物料编码）
        col_groups_global = _cluster_1d(lines, "cx", max(2.0, med_w * 0.5))
        col_of_global: dict[int, int] = {}
        for ci, g in enumerate(col_groups_global):
            for l in g:
                col_of_global[l["i"]] = ci
        grid_global = [["" for _ in col_groups_global] for _ in row_groups]
        for l in lines:
            ri = row_of[l["i"]]
            ci = col_of_global[l["i"]]
            grid_global[ri][ci] = (grid_global[ri][ci] + " " + l["text"]).strip()

        def global_role(ci: int) -> str:
            text = grid_global[header_idx][ci] if ci < len(grid_global[header_idx]) else ""
            return _header_role(text)

        row_col_global = next((ci for ci in range(len(col_groups_global)) if global_role(ci) == "row"), None)
        code_col_global = next((ci for ci in range(len(col_groups_global)) if global_role(ci) == "code"), None)
        strong_possible = False
        if row_col_global is not None and code_col_global is not None:
            for ri in range(header_idx + 1, len(row_groups)):
                c0 = grid_global[ri][row_col_global].strip()
                c1 = grid_global[ri][code_col_global].replace(" ", "")
                if re.fullmatch(r"\d+", c0) and re.fullmatch(r"\d{6,}", c1):
                    strong_possible = True
                    break

        if strong_possible:
            # 采购订单：沿用全局列聚类（对带行号/物料编码的版式最稳）
            header_cols: list[dict] = []
            for ci, g in enumerate(col_groups_global):
                text = " ".join(l["text"] for l in g if row_of[l["i"]] == header_idx)
                if not text:
                    text = grid_global[header_idx][ci] if ci < len(grid_global[header_idx]) else ""
                center = sum(l["cx"] for l in g) / len(g)
                header_cols.append({"cx": center, "role": _header_role(text), "text": text})
        else:
            # 新格式：以表头行定义列（合并同一列内的表头碎片，如「公司/厂家/品牌」）
            header_col_groups = _cluster_1d(header_lines, "cx", max(10.0, med_w * 0.5))
            header_cols = []
            for g in header_col_groups:
                center = sum(l["cx"] for l in g) / len(g)
                text = " ".join(l["text"] for l in g)
                header_cols.append({"cx": center, "role": _header_role(text), "text": text})
        header_cols.sort(key=lambda c: c["cx"])

        # 每行文字归到最近的表头列
        col_of: dict[int, int] = {}
        for l in lines:
            col_of[l["i"]] = min(range(len(header_cols)), key=lambda ci: abs(l["cx"] - header_cols[ci]["cx"]))
        ncols = len(header_cols)

        grid = [["" for _ in range(ncols)] for _ in row_groups]
        grid_lines = [[[] for _ in range(ncols)] for _ in row_groups]
        for l in lines:
            ri = row_of[l["i"]]
            ci = col_of[l["i"]]
            grid[ri][ci] = (grid[ri][ci] + " " + l["text"]).strip()
            grid_lines[ri][ci].append(l)

        # 列角色
        role_col: dict[str, int] = {}
        for ci, hc in enumerate(header_cols):
            if hc["role"] != "other" and hc["role"] not in role_col:
                role_col[hc["role"]] = ci
        name_col = role_col.get("name", 0)
        code_col = role_col.get("code")
        row_col = role_col.get("row")

        # 数据行：优先强锚点（行号 + 物料编码），否则退化为“名称列 + 数字列”
        def is_footer_row(ri: int) -> bool:
            return any(w in " ".join(grid[ri]) for w in ("合计", "总计", "大写"))

        def numeric_cols() -> list[int]:
            return [role_col.get(k) for k in ("qty", "price", "amount", "qp") if role_col.get(k) is not None]

        def has_numbers(ri: int) -> bool:
            return any(_first_number(grid[ri][ci]) for ci in numeric_cols())

        strong_data: list[int] = []
        if row_col is not None and code_col is not None:
            for ri in range(header_idx + 1, len(row_groups)):
                if is_footer_row(ri):
                    continue
                c0 = grid[ri][row_col].strip()
                c1 = grid[ri][code_col].strip()
                if re.fullmatch(r"\d+", c0) and re.fullmatch(r"\d{6,}", c1.replace(" ", "")):
                    strong_data.append(ri)

        if strong_data:
            data_idxs = strong_data
        else:
            # 通用退化：以数字行为数据锚点（名称可能被拆到相邻碎片行）
            data_idxs = [
                ri for ri in range(header_idx + 1, len(row_groups))
                if not is_footer_row(ri) and has_numbers(ri)
            ]

        footer_idxs = {ri for ri in range(len(row_groups)) if is_footer_row(ri)}
        # 单据头碎片（供应商/采购员/单号等）不合并进明细
        _doc_header_words = ("采购员", "制单人", "验收员", "供应商", "供货单位", "订单编号", "单据日期", "单据编号", "采购组织", "采购部门", "备注：")
        fragment_idxs = [
            ri for ri in range(header_idx + 1, len(row_groups))
            if ri not in data_idxs and ri not in footer_idxs and any(grid[ri])
            and not any(w in " ".join(grid[ri]) for w in _doc_header_words)
        ]

        # 多行单元格碎片合并
        merged_lines: dict[int, list[list[dict]]] = {ri: [list(c) for c in grid_lines[ri]] for ri in data_idxs}
        for fi in fragment_idxs:
            has_name = bool(grid[fi][name_col].strip()) if name_col < len(grid[fi]) else False
            target = None
            if has_name:
                for cand in ([ri for ri in data_idxs if ri < fi] + [ri for ri in data_idxs if ri > fi]):
                    if not "".join(l["text"] for l in merged_lines[cand][name_col]).strip():
                        target = cand
                        break
            if target is None:
                target = next((ri for ri in data_idxs if ri > fi), None)
            if target is None:
                target = next((ri for ri in data_idxs if ri < fi), None)
            if target is None:
                continue
            for ci in range(ncols):
                if grid_lines[fi][ci]:
                    if target > fi:
                        merged_lines[target][ci] = merged_lines[target][ci] + grid_lines[fi][ci]
                    else:
                        merged_lines[target][ci] = grid_lines[fi][ci] + merged_lines[target][ci]

        def cell_text(ri: int, role: str) -> str:
            ci = role_col.get(role)
            if ci is None:
                return ""
            return " ".join(l["text"] for l in merged_lines[ri][ci]).strip()

        def cell_lines(ri: int, role: str) -> list[dict]:
            ci = role_col.get(role)
            return merged_lines[ri][ci] if ci is not None else []

        # 「数量单价」合列：若右侧存在未命名数字列，并入后按 x 拆数量/单价
        qp_col = role_col.get("qp")
        if qp_col is not None and role_col.get("price") is None:
            for ci in range(qp_col + 1, ncols):
                if header_cols[ci]["role"] == "other" and any(
                    re.search(r"\d", l["text"]) for ri in data_idxs for l in merged_lines[ri][ci]
                ):
                    role_col["price"] = ci
                    break

        items = []
        for ri in data_idxs:
            qty, price = "", ""
            if role_col.get("qp") is not None and (role_col.get("qty") is None or role_col.get("price") is None):
                qp_lines = cell_lines(ri, "qp")
                if role_col.get("price") is not None and role_col["price"] != qp_col:
                    qp_lines = qp_lines + cell_lines(ri, "price")
                qty, price = _split_qp(qp_lines)
            else:
                qty = _first_number(cell_text(ri, "qty"))
                price = _first_number(cell_text(ri, "price"))
            items.append({
                "product_name": _clean_name(cell_text(ri, "name")),
                "material_code": cell_text(ri, "code"),
                "spec": cell_text(ri, "spec"),
                "unit": cell_text(ri, "unit"),
                "qty": qty,
                "price": price,
                "amount": _first_number(cell_text(ri, "amount")),
                "remark": cell_text(ri, "remark"),
            })

        # 供应商/单号：从 overall_ocr_res 提取
        overall = page.get("overall_ocr_res") or {}
        _all_texts = overall.get("rec_texts")
        all_texts = [str(t) for t in (_all_texts if _all_texts is not None else [])]

        def find_text(prefix: str) -> str:
            pattern = re.compile(r"(?:" + prefix + r")[:：]?\s*([^\s，,。；;|]{2,60})")
            for t in all_texts:
                m = pattern.search(t)
                if m and m.group(1):
                    return m.group(1).strip()
            return ""

        return {
            "supplier_name": find_text("供应商|供货单位|供方|销售方|卖方|开票单位|收款单位"),
            "bill_no": find_text("订单编号|送货单号|单据编号|单据号|订单号|采购单号|采购订单号|合同编号|合同号"),
            "items": items,
        }

    def health(self) -> bool:
        try:
            self._ensure_init()
            return True
        except Exception:
            return False


def get_table_structure_engine(db=None, model_version: str | None = None) -> PaddleTableStructureEngine:
    """按系统配置创建表格结构识别引擎（默认 PP-OCRv6）。"""
    if model_version is None and db is not None:
        from sqlalchemy import select

        from app.models.sys import SysConfig

        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.model_version"))
        if cfg and cfg.config_value:
            model_version = cfg.config_value
    return PaddleTableStructureEngine(model_version=model_version or "PP-OCRv6")
