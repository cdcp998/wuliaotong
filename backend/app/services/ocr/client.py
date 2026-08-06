"""OCR 引擎抽象层（依据《数据库设计.md》决策10、《后端API设计.md》§11.2）。

统一 `OCRClient` 接口；P0 实现 `RapidOCREngine`（Windows，RapidOCR-json 子进程常驻）。
引擎选择存 sys_config（ocr.engine = rapidocr/paddle），由 `get_ocr_engine()` 工厂创建；
切换引擎只影响本层，结构化/匹配/大模型链路不变。PaddleOCREngine 在 Debian 部署阶段实现。
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Protocol

from app.config import settings
from app.services.ocr.rapidocr_api import OcrAPI


class OCRInitError(RuntimeError):
    """OCR 引擎初始化/识别失败（对应错误码 5001）。"""


class OcrLine:
    """与引擎无关的结构化识别结果（一行文字）。"""

    __slots__ = ("text", "score", "box")

    def __init__(self, text: str, score: float, box: list) -> None:
        self.text = text
        self.score = score
        self.box = box


class OCRClient(Protocol):
    """所有 OCR 引擎必须实现的统一接口。"""

    name: str

    def recognize(self, image_bytes: bytes) -> list[OcrLine]:
        """识别图片字节流，返回按行排列的文字结果。"""
        ...

    def health(self) -> bool:
        """引擎是否可用。"""
        ...


class RapidOCREngine:
    """RapidOCR-json（Windows）实现：OcrAPI 子进程常驻，线程锁串行调用。"""

    name = "rapidocr"

    def __init__(self) -> None:
        self._api: OcrAPI | None = None
        self._lock = threading.Lock()

    def _ensure_init(self) -> OcrAPI:
        if self._api is None:
            with self._lock:
                if self._api is None:
                    # 初始化失败（引擎缺失/超时）会抛异常，由调用方捕获转 5001
                    self._api = OcrAPI()
        return self._api

    def recognize(self, image_bytes: bytes) -> list[OcrLine]:
        api = self._ensure_init()
        res = api.runBytes(image_bytes)
        if res.get("code") != 100:
            raise OCRInitError(f"识别失败 code={res.get('code')}: {res.get('data')}")
        return [OcrLine(line["text"], line["score"], line["box"]) for line in res["data"]]

    def health(self) -> bool:
        try:
            self._ensure_init()
            return True
        except Exception:
            return False


# PaddleOCREngine：Debian/Linux 部署阶段实现（paddleocr CPU 推理），见开发排期 P5


def get_ocr_engine(engine: str | None = None) -> OCRClient:
    """按配置创建 OCR 引擎实例。engine 为空时读 settings（默认 rapidocr）。"""
    engine = engine or settings.ocr_engine
    if engine == "rapidocr":
        return RapidOCREngine()
    if engine == "paddle":
        raise NotImplementedError("PaddleOCREngine 在 Debian 部署阶段实现")
    raise ValueError(f"未知 OCR 引擎: {engine}")


def ocr_engine_available(engine: str) -> bool:
    """引擎资源是否就绪（只检查资产文件，不启动进程；供 /health 使用）。"""
    if engine == "rapidocr":
        exe = Path(__file__).resolve().parents[3] / "ocr" / "RapidOCR-json.exe"
        return exe.is_file()
    return False
