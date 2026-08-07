"""条形码/二维码解码服务（zxing-cpp）。

《数据库设计.md》§8.3：条形码用 zxing-cpp 服务端解码，RapidOCR 只识别文字。
zxing-cpp 的 read_barcodes 需要 2D/3D 像素缓冲（PIL Image / numpy 数组），
不接受 PNG/JPEG 压缩字节，因此先用 Pillow 解码图片再送入识别。
"""
from __future__ import annotations

import io

from PIL import Image

from app.core.response import BizError, E_PARAM

try:  # 未安装时接口返回可读错误，不阻断其他功能
    import zxingcpp
except Exception:  # pragma: no cover - 依赖缺失场景
    zxingcpp = None  # type: ignore[assignment]


def decode_barcode(data: bytes) -> str:
    """解码图片中的第一个条形码/二维码，返回其文本值。

    识别不到时抛 BizError(E_PARAM, \"未识别到条形码/二维码\")。
    """
    if zxingcpp is None:
        raise BizError(E_PARAM, "条码解码组件未安装（pip install zxing-cpp）")
    try:
        img = Image.open(io.BytesIO(data)).convert("L")
    except Exception as e:
        raise BizError(E_PARAM, f"图片解析失败：{e}")
    results = zxingcpp.read_barcodes(img)
    for r in results:
        text = (r.text or "").strip()
        if r.valid and text:
            return text
    raise BizError(E_PARAM, "未识别到条形码/二维码")


def _read_barcode(img: Image.Image) -> str | None:
    """对单张灰度图执行一次 zxing-cpp 解码，返回第一个有效条码值。"""
    try:
        results = zxingcpp.read_barcodes(img)
    except Exception:
        return None
    for r in results:
        text = (r.text or "").strip()
        if r.valid and text:
            return text
    return None


def try_decode_barcode(data: bytes) -> str | None:
    """解码图片中的第一个条形码/二维码；组件缺失/图片解析失败/识别不到均返回 None。

    供 /ocr/quick 识别链路首步使用：图片没条码时静默继续后续 OCR 流程，不报错。
    原尺寸解不到时放大 2 倍再试一次（实拍照片中小/模糊条码解码率明显提升）。
    """
    if zxingcpp is None:
        return None
    try:
        img = Image.open(io.BytesIO(data)).convert("L")
    except Exception:
        return None
    value = _read_barcode(img)
    if value:
        return value
    # 放大重试：限制原图长边 ≤4000（放大后 ≤8000），避免超大图内存开销
    w, h = img.size
    if 0 < max(w, h) <= 4000:
        try:
            value = _read_barcode(img.resize((w * 2, h * 2), Image.LANCZOS))
        except Exception:
            return None
    return value
