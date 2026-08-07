"""PP-OCR 引擎参数降级链测试（不依赖真实 paddleocr 安装）。

覆盖：新版 paddleocr 移除 show_log 参数时自动降级重试；
全部参数组合失败时抛出 OCRInitError。
"""
import pytest

from app.services.ocr.client import OCRInitError
from app.services.ocr.paddleocr_api import PaddleOCREngine


def test_paddle_engine_drops_show_log(monkeypatch) -> None:
    """新版 paddleocr 不支持 show_log → 降级链第二次（无 show_log）初始化成功。"""
    calls: list[dict] = []

    class _FakePaddleOCR:
        def __init__(self, **kw) -> None:
            calls.append(kw)
            if "show_log" in kw:
                raise ValueError("Unknown argument: show_log")

    monkeypatch.setattr("app.services.ocr.paddleocr_api._load_paddleocr", lambda: _FakePaddleOCR)
    engine = PaddleOCREngine(model_version="PP-OCRv6")
    ocr = engine._ensure_init()
    assert ocr is not None
    # 成功的那次调用不带 show_log，且保留 ocr_version
    assert "show_log" not in calls[-1]
    assert calls[-1]["ocr_version"] == "PP-OCRv6"
    assert calls[-1]["lang"] == "ch"


def test_paddle_engine_drops_ocr_version(monkeypatch) -> None:
    """旧版 paddleocr 连 ocr_version 也不支持 → 降级到默认模型。"""
    calls: list[dict] = []

    class _FakePaddleOCR:
        def __init__(self, **kw) -> None:
            calls.append(kw)
            if "show_log" in kw or "ocr_version" in kw:
                raise ValueError("Unknown argument: ocr_version")

    monkeypatch.setattr("app.services.ocr.paddleocr_api._load_paddleocr", lambda: _FakePaddleOCR)
    engine = PaddleOCREngine(model_version="PP-OCRv6")
    ocr = engine._ensure_init()
    assert ocr is not None
    assert "ocr_version" not in calls[-1]
    assert "show_log" not in calls[-1]


def test_paddle_engine_all_variants_fail(monkeypatch) -> None:
    """全部参数组合均失败 → OCRInitError（可读提示）。"""

    class _FakePaddleOCR:
        def __init__(self, **kw) -> None:  # noqa: ARG002
            raise ValueError("bad")

    monkeypatch.setattr("app.services.ocr.paddleocr_api._load_paddleocr", lambda: _FakePaddleOCR)
    engine = PaddleOCREngine(model_version="PP-OCRv6")
    with pytest.raises(OCRInitError):
        engine._ensure_init()
