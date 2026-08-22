"""knowledge 模块 ORM（线缆和设备插件方案 §4.4，4 张表）。"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class KnowledgeArticle(Base):
    __tablename__ = "knowledge_article"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_cable_types: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_fault_types: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_type: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0草稿/1已发布/2已归档
    source_task_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    published_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class KnowledgeArticleRevision(Base):
    __tablename__ = "knowledge_article_revision"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    article_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1已发布快照/2归档快照
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class KnowledgeMaterialLink(Base):
    __tablename__ = "knowledge_material_link"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    article_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    note: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class KnowledgeGenerateTask(Base):
    __tablename__ = "knowledge_generate_task"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="queued")  # queued/running/success/failed
    input: Mapped[str] = mapped_column(Text, nullable=False)
    article_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    model: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    last_error: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
