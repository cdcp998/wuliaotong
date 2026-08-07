"""文件上传/读取（《后端API设计.md》§7）：多存储地址策略落盘 + Pillow 压缩 + 水印预览。"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.response import BizError, E_FILE_FAILED, E_NO_PERMISSION, E_NOT_FOUND, ok
from app.db import get_db
from app.models.sys import SysConfig, SysFile, SysRole, SysStorage, SysUser
from app.schemas.watermark import FileWatermarkReq
from app.services.storage import choose_storage, resolve_storage_path, save_uploaded_image
from app.services.watermark import (
    WATERMARK_DEFAULT_POSITION,
    WATERMARK_DEFAULT_TEMPLATE,
    WATERMARK_POSITIONS,
    render_template,
    render_watermark,
)

router = APIRouter(tags=["文件"], dependencies=[Depends(get_current_user)])

ALLOWED_TYPES = ("image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif")


@router.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    biz_type: str = Query("other", max_length=30),
    biz_id: int = Query(0),
    storage_id: int = Query(0, description="manual 策略或强制指定时使用"),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if file.content_type not in ALLOWED_TYPES:
        raise BizError(E_FILE_FAILED, "仅支持图片文件（jpg/png/webp/bmp/gif）")
    data = await file.read()
    if not data:
        raise BizError(E_FILE_FAILED, "文件为空")
    if len(data) > 10 * 1024 * 1024:
        raise BizError(E_FILE_FAILED, "单张图片不能超过 10MB")

    storage = choose_storage(db, storage_id)
    f = save_uploaded_image(
        db,
        data=data,
        original_name=file.filename or "upload",
        biz_type=biz_type,
        biz_id=biz_id,
        storage_id=storage.id,
        uploader_id=user.id,
    )
    db.commit()
    if biz_type == "purchase_bill":
        # 送货单原图按日期归档（供后期训练使用；best-effort，失败不影响主流程）
        from app.services.ocr.sample_archive import archive_delivery_sample

        archive_delivery_sample(data, f.id, file.filename or "upload", user.id)
    return ok({"file_id": f.id, "url": f"/api/v1/files/{f.id}", "storage_id": f.storage_id, "size": f.file_size})


_MEDIA_BY_EXT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif",
}


@router.get("/files/{file_id}")
def get_file(file_id: int, db: Session = Depends(get_db)) -> FileResponse:
    f = db.get(SysFile, file_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "文件不存在")
    storage = db.get(SysStorage, f.storage_id)
    path = resolve_storage_path(storage) / f.file_path
    if not path.is_file():
        raise BizError(E_NOT_FOUND, "文件已丢失")
    # 按文件扩展名返回真实类型（此前写死 webp，与 jpg/png 等实际内容不符）
    media = _MEDIA_BY_EXT.get(Path(f.original_name or "").suffix.lower(), "application/octet-stream")
    return FileResponse(Path(path), media_type=media, filename=f.original_name)


@router.post("/files/{file_id}/watermark-preview")
def file_watermark_preview(
    file_id: int,
    req: FileWatermarkReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """真实照片水印预览（完成工作拍照提交前）：按当前系统模板/位置即时渲染，原始照片不保存水印。
    仅本人或管理员可预览。"""
    f = db.get(SysFile, file_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "文件不存在")
    role = db.get(SysRole, user.role_id)
    if f.uploader_id != user.id and not (role and role.code == "super_admin"):
        raise BizError(E_NO_PERMISSION, "只能预览自己上传的照片", http_status=403)
    storage = db.get(SysStorage, f.storage_id)
    path = resolve_storage_path(storage) / f.file_path
    if not path.is_file():
        raise BizError(E_NOT_FOUND, "文件已丢失")

    template = db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.template")) or WATERMARK_DEFAULT_TEMPLATE
    position = db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.position")) or WATERMARK_DEFAULT_POSITION
    bg_cfg = db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.bg_opaque"))
    gps = f"{req.lat},{req.lng}" if req.lat and req.lng else "未获取定位"
    text = render_template(template, req.location or "使用地点", req.time, gps)
    img = render_watermark(
        Image.open(path),
        text,
        position if position in WATERMARK_POSITIONS else WATERMARK_DEFAULT_POSITION,
        bg_opaque=bg_cfg != "0",
    )
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")
