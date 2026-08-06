"""OCR/大模型 ORM 模型（对应《数据库设计.md》§2.10，2 张表）。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db import Base
from app.models.sys import TimestampMixin


class OcrRecord(TimestampMixin, Base):
    __tablename__ = "ocr_record"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    file_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ocr_type: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 送货单 / 2 商品外包装 / 3 标签型号
    engine: Mapped[str] = mapped_column(String(20), nullable=False, default="rapidocr")
    raw_result: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    structured: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    matched_product_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    match_status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 1 已匹配 / 2 未匹配 / 3 人工修正
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class AiSuggestion(TimestampMixin, Base):
    __tablename__ = "ai_suggestion"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ocr_record_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_name: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(20), nullable=False)
    suggestion: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1 待处理 / 2 已新增商品 / 3 已忽略
    new_product_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    handled_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
