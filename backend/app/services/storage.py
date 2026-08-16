"""多存储地址服务：路径解析、存储选择策略、图片压缩落盘（《数据库设计.md》决策11）。

策略：
- fill   最空闲：选已存文件占用字节最少的启用存储（默认）
- round  轮询：按 sys_config(storage.round_seq) 依序分配
- manual 手动：请求显式指定 storage_id；未指定用 is_default=1 的存储
"""
from __future__ import annotations

import hashlib
import io
import re
import shutil
import uuid
from pathlib import Path

from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import BASE_DIR
from app.core.response import BizError, E_FILE_FAILED, E_NOT_FOUND, E_PARAM
from app.models.sys import SysConfig, SysFile, SysStorage

MAX_EDGE = 1600  # 压缩后长边上限
JPEG_QUALITY = 80
# 解码像素上限：拦截解压炸弹类超大图片（默认约 8900 万像素，正常照片远小于此值）
Image.MAX_IMAGE_PIXELS = 60_000_000


def resolve_storage_path(storage: SysStorage) -> Path:
    """存储配置 path → 绝对路径：相对路径基于 backend/ 解析，支持盘符/UNC 绝对路径。"""
    p = Path(storage.path)
    if not p.is_absolute():
        p = BASE_DIR / p
    return p


def storage_usage(db: Session, storage_id: int) -> int:
    """该存储位置已用字节数（按 sys_file.file_size 统计）。"""
    return db.scalar(
        select(func.coalesce(func.sum(SysFile.file_size), 0)).where(SysFile.storage_id == storage_id)
    ) or 0


def choose_storage(db: Session, storage_id: int = 0) -> SysStorage:
    """按策略选择存储位置；无可用存储时抛 5003。"""
    enabled = db.scalars(select(SysStorage).where(SysStorage.status == 1).order_by(SysStorage.id)).all()
    if not enabled:
        raise BizError(E_FILE_FAILED, "没有可用的存储位置，请在系统设置中配置")
    if storage_id:
        storage = db.get(SysStorage, storage_id)
        if storage is None or storage.status != 1:
            raise BizError(E_PARAM, "指定的存储位置不存在或已停用")
        return storage

    # 自动选择排除 manual（仅显式指定时使用）；无其他可用时回退全部启用存储
    auto = [s for s in enabled if s.policy != "manual"] or enabled
    policy = next((s.policy for s in auto if s.is_default), auto[0].policy)
    if policy == "manual":
        default = next((s for s in auto if s.is_default), auto[0])
        return default
    if policy == "round":
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "storage.round_seq"))
        seq = int(cfg.config_value) if cfg else 0
        storage = auto[seq % len(auto)]
        if cfg is None:
            db.add(SysConfig(config_key="storage.round_seq", config_value=str(seq + 1), remark="轮询策略当前序号"))
        else:
            cfg.config_value = str(seq + 1)
        db.flush()
        return storage
    # fill：已用字节最少
    return min(auto, key=lambda s: (storage_usage(db, s.id), s.id))


def save_uploaded_image(db: Session, data: bytes, original_name: str, biz_type: str, biz_id: int, storage_id: int, uploader_id: int) -> SysFile:
    """压缩（WebP q80，长边≤1600px）并写入所选存储，登记 sys_file。必须在请求事务内调用。"""
    try:
        img = Image.open(io.BytesIO(data))
        img.thumbnail((MAX_EDGE, MAX_EDGE))  # 等比缩放，长边不超过 1600
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=JPEG_QUALITY)
        payload = buf.getvalue()
    except Exception:
        raise BizError(E_FILE_FAILED, "图片处理失败（仅支持常见图片格式）")

    storage = db.get(SysStorage, storage_id)
    if storage is None:
        raise BizError(E_NOT_FOUND, "存储位置不存在")
    root = resolve_storage_path(storage)
    # 纵深防御：业务类型只保留白名单字符并截断，杜绝 ../ 或分隔符逃逸存储根目录
    safe_biz = re.sub(r"[^A-Za-z0-9_-]", "", biz_type or "")[:30] or "other"
    rel = Path(f"{safe_biz}/{uuid.uuid4().hex}.webp")
    try:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(payload)
    except OSError as e:
        raise BizError(E_FILE_FAILED, f"写入存储失败：{e}")

    f = SysFile(
        biz_type=biz_type or "other",
        biz_id=biz_id,
        storage_id=storage_id,
        original_name=original_name[:255],
        file_path=rel.as_posix(),
        file_size=len(payload),
        md5=hashlib.md5(payload).hexdigest(),
        uploader_id=uploader_id,
    )
    db.add(f)
    db.flush()
    return f


def storage_health(storage: SysStorage) -> dict:
    """单存储健康检查：路径存在/可写/总空间/剩余空间。"""
    root = resolve_storage_path(storage)
    exists = root.exists()
    writable = os_access_ok(root)
    info = {"id": storage.id, "name": storage.name, "path": str(root), "exists": exists, "writable": writable}
    try:
        usage = shutil.disk_usage(root if exists else root.anchor or root)
        info["total_gb"] = round(usage.total / 1024**3, 2)
        info["free_gb"] = round(usage.free / 1024**3, 2)
    except OSError:
        info["total_gb"] = info["free_gb"] = 0
    return info


def os_access_ok(root: Path) -> bool:
    try:
        if not root.exists():
            return False
        probe = root / ".wlt_probe"
        probe.write_text("ok")
        probe.unlink()
        return True
    except OSError:
        return False
