"""系统接口：health（《后端API设计.md》§9）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.core.response import ok
from app.db import get_db
from app.services.ocr.client import ocr_engine_available

router = APIRouter(tags=["系统"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return ok(
        {
            "status": "ok",
            "db": "ok",
            "ocr_engine": settings.ocr_engine,
            "ocr_ready": ocr_engine_available(settings.ocr_engine),
        }
    )
