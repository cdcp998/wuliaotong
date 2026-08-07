"""PP-OCR（PaddleOCR）引擎实现（Windows CPU）。

《后端API设计.md》§11.2：OCR 引擎抽象，PaddleOCREngine 与 RapidOCREngine 实现同一接口。
- 惰性初始化：首次识别时导入 paddleocr 并加载模型（约 1-3 秒），模型由 PaddleOCR 自动下载
  至用户目录 ~/.paddlex/official_models（也可用 scripts/setup_ppocr.py 预下载/验证）
- 模型版本：PP-OCRv4 / PP-OCRv5 / PP-OCRv6（由 sys_config ocr.model_version 配置，默认 PP-OCRv6）
- 未安装 paddleocr 时抛出 OCRInitError（提示运行 setup_ppocr.py 自动安装）
"""
from __future__ import annotations

import io
import threading

from PIL import Image

from app.services.ocr.client import OCRInitError, OcrLine

# paddleocr 未安装时延迟报错（接口层已 try/except 转 5001）
_paddleocr = None
_import_lock = threading.Lock()


def _load_paddleocr():
    """导入 paddleocr（首次约 0.5-1s）。未安装抛 OCRInitError 并附安装指引。"""
    global _paddleocr
    if _paddleocr is not None:
        return _paddleocr
    with _import_lock:
        if _paddleocr is None:
            try:
                from paddleocr import PaddleOCR  # noqa: PLC0415
            except ImportError as e:
                raise OCRInitError(
                    "未安装 PaddleOCR 运行环境。请运行："
                    "backend/.venv/Scripts/python.exe backend/scripts/setup_ppocr.py 自动安装（选择 PP-OCR 版本）"
                ) from e
            _paddleocr = PaddleOCR
    return _paddleocr


class PaddleOCREngine:
    """PaddleOCR（PP-OCR）实现：CPU/GPU 推理，单例常驻（paddleocr 进程内加载一次），线程锁串行调用。"""

    name = "paddle"

    def __init__(self, model_version: str = "PP-OCRv6") -> None:
        self.model_version = model_version
        self._ocr = None
        self._lock = threading.Lock()

    def _ensure_init(self):
        if self._ocr is None:
            with self._lock:
                if self._ocr is None:
                    PaddleOCR = _load_paddleocr()
                    # 参数降级链：不同 paddleocr 版本对参数支持不同（show_log 在新版被移除、
                    # ocr_version 需 3.4+），逐级去掉不兼容参数直到初始化成功
                    base: dict = {
                        "lang": "ch",
                        "use_doc_orientation_classify": False,
                        "use_doc_unwarping": False,
                        "use_textline_orientation": False,
                    }
                    variants: list[dict] = [
                        {**base, "show_log": False, "ocr_version": self.model_version},
                        {**base, "ocr_version": self.model_version},
                        {**base, "show_log": False},
                        dict(base),
                        {"lang": "ch"},
                    ]
                    last_err: Exception | None = None
                    for kw in variants:
                        try:
                            self._ocr = PaddleOCR(**kw)
                            break
                        except (TypeError, ValueError) as e:
                            # paddleocr 对未知参数抛 ValueError("Unknown argument: xxx")，旧版缺失参数抛 TypeError
                            last_err = e
                            continue
                    if self._ocr is None:
                        raise OCRInitError(f"PaddleOCR 初始化失败（参数不兼容）：{last_err}")
        return self._ocr

    def recognize(self, image_bytes: bytes) -> list[OcrLine]:
        ocr = self._ensure_init()
        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except Exception as e:
            raise OCRInitError(f"图片解析失败：{e}")
        import numpy as np  # noqa: PLC0415

        arr = np.array(img)  # RGB ndarray（paddleocr 内部转 BGR）
        try:
            results = ocr.predict(arr)
        except AttributeError:  # 旧版接口
            results = ocr.ocr(arr)
        return _parse_results(results)

    def health(self) -> bool:
        try:
            self._ensure_init()
            return True
        except Exception:
            return False


def _parse_results(results) -> list[OcrLine]:
    """兼容 PaddleOCR 3.x 两种返回格式：
    - predict()：list[dict]（rec_texts / rec_scores / rec_polys）
    - ocr()：list[ [ [box], (text, score) ], ... ]（旧格式）
    """
    out: list[OcrLine] = []
    if not results:
        return out
    for page in results:
        if isinstance(page, dict):  # 3.x predict 格式
            texts = page.get("rec_texts") or []
            scores = page.get("rec_scores") or []
            polys = page.get("rec_polys") or []
            for i, t in enumerate(texts):
                if not t:
                    continue
                out.append(OcrLine(str(t), float(scores[i]) if i < len(scores) else 0.99, list(polys[i]) if i < len(polys) else []))
        elif isinstance(page, list):  # 旧 ocr() 格式
            for item in page:
                if not item or len(item) < 2:
                    continue
                box, text_score = item[0], item[1]
                if isinstance(text_score, (list, tuple)) and len(text_score) >= 1:
                    out.append(OcrLine(str(text_score[0]), float(text_score[1]), list(box)))
    return out
