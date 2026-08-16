"""Excel 导出防护：阻止用户可控文本被解析为公式（公式注入）。

商品名/备注等字段可能以 = + - @ 或制表符开头，openpyxl 会把 "=" 开头的
字符串当公式写入 xlsx，打开报表即执行。导出前统一经 safe_excel_value()
处理，前缀单引号强制按文本存储。
"""
from __future__ import annotations

_EXCEL_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_excel_value(v):
    """字符串以公式/注入前缀开头时前置单引号，强制为文本单元格。"""
    if isinstance(v, str) and v.startswith(_EXCEL_FORMULA_PREFIXES):
        return "'" + v
    return v
