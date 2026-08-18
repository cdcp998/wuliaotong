"""表格结构识别后处理（坐标对齐）纯函数测试，不依赖真实模型。"""
from app.services.ocr.table_structure import (
    _clean_name,
    _first_number,
    _fit_slope,
    get_table_structure_engine,
)


def test_first_number_normalizes_trailing_zeros() -> None:
    assert _first_number("350.0000000 0") == "350"
    assert _first_number("1.0000") == "1"
    assert _first_number("350.0000") == "350"
    assert _first_number("1400.0000") == "1400"
    assert _first_number("abc") == ""


def test_clean_name_removes_cjk_spaces() -> None:
    assert _clean_name("网络视频监控测 试仪") == "网络视频监控测试仪"
    assert _clean_name("800万网络摄像头") == "800万网络摄像头"


def test_fit_slope_requires_min_points() -> None:
    assert _fit_slope([]) == 0.0
    assert _fit_slope([(0, 0), (1, 1)]) == 0.0


def test_get_table_structure_engine_default() -> None:
    engine = get_table_structure_engine()
    assert engine.model_version == "PP-OCRv6"
    assert engine.name == "paddle_table_structure"
