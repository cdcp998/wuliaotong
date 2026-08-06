"""文件上传/读取（《后端API设计.md》§7）：多存储地址策略落盘 + Pillow 压缩。"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.response import BizError, E_FILE_FAILED, E_NOT_FOUND, ok
from app.db import get_db
from app.models.sys import SysFile, SysStorage, SysUser
from app.services.storage import choose_storage, resolve_storage_path, save_uploaded_image

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
    return ok({"file_id": f.id, "url": f"/api/v1/files/{f.id}", "storage_id": f.storage_id, "size": f.file_size})


@router.get("/files/{file_id}")
def get_file(file_id: int, db: Session = Depends(get_db)) -> FileResponse:
    f = db.get(SysFile, file_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "文件不存在")
    storage = db.get(SysStorage, f.storage_id)
    path = resolve_storage_path(storage) / f.file_path
    if not path.is_file():
        raise BizError(E_NOT_FOUND, "文件已丢失")
    return FileResponse(Path(path), media_type="image/webp", filename=f.original_name)
