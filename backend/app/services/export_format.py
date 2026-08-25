"""导出格式设置（ExportFormat）：解析前端「导出格式设置」生成的规格并应用到 xlsx 导出。

规格 JSON 结构（前端 ExportFormatModal 生成，随导出请求以 fmt 参数传递）：
{
  "order":  [3, 1, 0],                       # 选中的源列下标（按导出顺序）
  "fmt":    {"1": {"type": "text"},          # default|text|number|date|custom
             "2": {"type": "number", "decimals": 2},
             "3": {"type": "custom", "custom": "@"}},
  "width":  {"default": "auto", "cols": {"0": 24}},
  "global": {"longNumberAsText": true, "wrapText": true, "noShrinkToFit": true}
}
解析一律宽容：非法/缺失项回退默认（无 spec = 原始行为）。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

# ≥15 位纯数字（身份证号/长订单号等）：Excel 数值仅 15 位精度，必须按文本处理
_LONG_DIGITS = re.compile(r"^\d{15,}$")

_FORMAT_TYPES = ("default", "text", "number", "date", "custom")


@dataclass
class ColumnFormat:
    type: str = "default"           # default/text/number/date/custom
    decimals: int | None = None     # 数值小数位
    custom: str = ""                # Excel 自定义格式代码


@dataclass
class ExportSpec:
    """已解析的导出格式规格（列序引用源数据的原始下标）。"""

    order: list[int] = field(default_factory=list)
    fmt: dict[int, ColumnFormat] = field(default_factory=dict)
    col_widths: dict[int, float] = field(default_factory=dict)
    width_default: str = "auto"     # auto | manual（manual 时未指定的列回退 auto）
    manual_width: float = 20.0
    long_number_as_text: bool = True
    wrap_text: bool = True
    no_shrink_to_fit: bool = True

    def has_column_filter(self) -> bool:
        return bool(self.order)


def _as_int(v, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _as_width(v, default: float) -> float:
    try:
        w = float(v)
        return w if w > 0 else default
    except (TypeError, ValueError):
        return default


def parse_export_spec(raw: str | None) -> ExportSpec | None:
    """宽容解析 fmt 参数：任何异常返回 None（调用方按无规格处理）。"""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
    except ValueError:
        return None

    spec = ExportSpec()
    order = data.get("order")
    if isinstance(order, list):
        spec.order = [_as_int(x, 0, 10_000, -1) for x in order]
        spec.order = [i for i in spec.order if i >= 0]

    fmt_raw = data.get("fmt")
    if isinstance(fmt_raw, dict):
        for k, v in fmt_raw.items():
            try:
                idx = int(k)
            except (TypeError, ValueError):
                continue
            if not isinstance(v, dict):
                continue
            ftype = v.get("type") if v.get("type") in _FORMAT_TYPES else "default"
            cf = ColumnFormat(type=ftype)
            if v.get("decimals") is not None:
                cf.decimals = _as_int(v.get("decimals"), 0, 8, 2)
            custom = str(v.get("custom") or "")[:60]
            cf.custom = custom
            if ftype == "number":
                cf.custom = cf.custom or ("0." + "0" * (cf.decimals or 0) if cf.decimals else "0")
            spec.fmt[idx] = cf

    width = data.get("width")
    if isinstance(width, dict):
        spec.width_default = "manual" if width.get("default") == "manual" else "auto"
        spec.manual_width = _as_width(width.get("manual"), 20.0)
        cols = width.get("cols")
        if isinstance(cols, dict):
            for k, v in cols.items():
                try:
                    spec.col_widths[int(k)] = _as_width(v, 20.0)
                except (TypeError, ValueError):
                    continue

    glob = data.get("global")
    if isinstance(glob, dict):
        spec.long_number_as_text = glob.get("longNumberAsText", True)
        spec.wrap_text = glob.get("wrapText", True)
        spec.no_shrink_to_fit = glob.get("noShrinkToFit", True)
    return spec


def is_long_number(value) -> bool:
    """数值或数字字符串是否为 ≥15 位的长号码（需强制文本避免精度丢失）。"""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return abs(value) >= 10**14
    if isinstance(value, float):
        return False  # 浮点已是近似值，转文本也无法恢复精度（由上游以字符串提供）
    if isinstance(value, str):
        s = value.strip()
        return bool(_LONG_DIGITS.match(s))
    return False
