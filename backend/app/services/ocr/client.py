"""OCR 引擎抽象层（依据《数据库设计.md》决策10、《后端API设计.md》§11.2）。

统一 `OCRClient` 接口；`RapidOCREngine`（Windows，RapidOCR-json **单次进程**：每次识别新建进程，结果返回即销毁）。
引擎选择存 sys_config（ocr.engine = rapidocr/paddle），由 `get_ocr_engine()` 工厂创建；
切换引擎只影响本层，结构化/匹配/大模型链路不变。
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.sys import SysConfig
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
    """RapidOCR-json（Windows）实现：**单次进程**——每次识别新建进程，结果返回即销毁（非常驻）。

    RapidOCR-json 处理完一张图即退出，因此不缓存实例；每次识别重新启动进程，
    天然并发安全（无共享管道状态），代价是每次识别含模型加载（约 1-2 秒）。
    """

    name = "rapidocr"

    def recognize(self, image_bytes: bytes) -> list[OcrLine]:
        api = OcrAPI()
        try:
            res = api.runBytes(image_bytes)
            if res.get("code") != 100:
                raise OCRInitError(f"识别失败 code={res.get('code')}: {res.get('data')}")
            return [OcrLine(line["text"], line["score"], line["box"]) for line in res["data"]]
        finally:
            api.stop()  # 进程已随结果返回退出，此处兜底清理

    def health(self) -> bool:
        try:
            api = OcrAPI()
            api.stop()
            return True
        except Exception:
            return False


# PaddleOCREngine：PP-OCR（paddleocr 3.x，Windows/Linux CPU 均可用）
# 模型版本由 sys_config ocr.model_version 配置（PP-OCRv4/v5/v6，默认 PP-OCRv6）


def get_ocr_engine(db: Session | None = None, engine: str | None = None) -> OCRClient:
    """按配置创建 OCR 引擎实例。

    优先级：显式 engine > 数据库 sys_config(ocr.engine，后台可切换) > 环境变量默认。
    引擎选择由管理员在后台「系统设置」维护，切换只影响识别层。
    """
    if engine is None:
        engine = settings.ocr_engine
        if db is not None:
            cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.engine"))
            if cfg and cfg.config_value:
                engine = cfg.config_value
    if engine == "off":
        raise ValueError("识别引擎已关闭：请在「系统设置 - 识别引擎」中选择开启后再使用识别功能")
    if engine == "rapidocr":
        return RapidOCREngine()
    if engine == "paddle":
        model_version = "PP-OCRv6"
        if db is not None:
            cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.model_version"))
            if cfg and cfg.config_value:
                model_version = cfg.config_value
        from app.services.ocr.paddleocr_api import PaddleOCREngine

        return PaddleOCREngine(model_version=model_version)
    raise ValueError(f"未知 OCR 引擎: {engine}")


def ocr_engine_available(engine: str) -> bool:
    """引擎资源是否就绪（只检查资产文件/依赖，不启动进程；供 /health 使用）。"""
    if engine == "rapidocr":
        exe = Path(__file__).resolve().parents[3] / "ocr" / "RapidOCR-json.exe"
        return exe.is_file()
    if engine == "paddle":
        import importlib.util

        return importlib.util.find_spec("paddleocr") is not None
    return False
