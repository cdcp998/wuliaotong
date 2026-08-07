"""送货单样本归档（后期训练数据收集，best-effort 不阻断主流程）。

- 归档内容：送货单识别入库流程上传的**原始图片字节**（压缩前，训练用最佳质量）
- 目录结构：backend/data/ocr_training/送货单/YYYY-MM-DD/<HHMMSS>_f{file_id}_{uuid8>.<ext>
  （按上传时间分目录保存，便于按日期筛选训练样本）
- 识别任务完成后，识别线程补写同名 .json：{file_id, structured, engine, created_at}
  （图片 + 结构化结果成对保存，供后期训练/评测使用）
- 归档失败（磁盘满/权限等）一律静默，绝不影响上传/识别主流程
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("app.ocr.sample_archive")

# backend/data/ocr_training/送货单/...
ARCHIVE_ROOT = Path(__file__).resolve().parents[3] / "data" / "ocr_training" / "送货单"

_EXT_BY_NAME = {".jpg": ".jpg", ".jpeg": ".jpg", ".png": ".png", ".webp": ".webp", ".bmp": ".bmp", ".gif": ".gif"}


def _stem(file_id: int, now: datetime) -> str:
    return f"{now.strftime('%H%M%S')}_f{file_id}_{uuid.uuid4().hex[:8]}"


def archive_delivery_sample(data: bytes, file_id: int, original_name: str, uploader_id: int) -> str | None:
    """上传时归档送货单原图；返回相对归档根目录的路径（失败返回 None，不抛异常）。"""
    if not data:
        return None
    try:
        now = datetime.now()
        ext = _EXT_BY_NAME.get(Path(original_name or "").suffix.lower(), ".jpg")
        day_dir = ARCHIVE_ROOT / now.strftime("%Y-%m-%d")
        day_dir.mkdir(parents=True, exist_ok=True)
        rel = f"{now.strftime('%Y-%m-%d')}/{_stem(file_id, now)}{ext}"
        (ARCHIVE_ROOT / rel).write_bytes(data)
        meta = {"file_id": file_id, "uploader_id": uploader_id, "original_name": original_name[:255],
                "uploaded_at": now.isoformat(timespec="seconds")}
        (ARCHIVE_ROOT / rel).with_suffix(".json").write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        logger.info("送货单样本归档 file_id=%s -> %s", file_id, rel)
        return rel
    except OSError as e:  # 磁盘满/权限等：归档失败不影响主流程
        logger.warning("送货单样本归档失败 file_id=%s: %s", file_id, e)
        return None


def write_delivery_sample_result(file_id: int, structured: dict | None, ocr_type: int = 1) -> None:
    """识别任务完成后补写结构化结果到该文件最新归档的 .json（训练用「图+标注」配对）。"""
    if ocr_type != 1 or not ARCHIVE_ROOT.is_dir():
        return
    try:
        cands = sorted(ARCHIVE_ROOT.glob(f"*/*_f{file_id}_*.json"), key=lambda p: p.name, reverse=True)
        if not cands:
            return
        path = cands[0]
        meta = json.loads(path.read_text(encoding="utf-8"))
        meta["structured"] = structured
        meta["recognized_at"] = datetime.now().isoformat(timespec="seconds")
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:  # noqa: BLE001 归档为 best-effort
        logger.warning("送货单识别结果归档失败 file_id=%s", file_id, exc_info=True)
