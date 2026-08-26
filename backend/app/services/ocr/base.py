"""OCR 共享契约：错误类型、结构化行结果、客户端协议（《数据库设计.md》决策10、《后端API设计.md》§11.2）。

独立成模块的原因：client.py（引擎工厂）与各引擎实现互不依赖，只共同依赖本模块，
从根上消除历史上「client ⇄ paddleocr_api」的循环导入
（工厂惰性导入引擎类、引擎回引错误类型）。
"""
from __future__ import annotations

from typing import Protocol


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
