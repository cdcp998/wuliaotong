"""knowledge 模块 Pydantic schemas。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50000)
    category: str = Field(default="", max_length=50)
    tags: list[str] = Field(default_factory=list, max_length=20)
    related_cable_types: list[str] = Field(default_factory=list)
    related_fault_types: list[str] = Field(default_factory=list)


class ArticleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=50000)
    category: str | None = Field(default=None, max_length=50)
    tags: list[str] | None = None
    related_cable_types: list[str] | None = None
    related_fault_types: list[str] | None = None


class GenerateReq(BaseModel):
    title: str = Field(default="", max_length=200)
    topic: str = Field(min_length=1, max_length=200, description="生成主题（故障/场景）")
    context: str = Field(default="", max_length=5000, description="补充背景（如现场描述/故障类型/线缆类型）")


class SearchReq(BaseModel):
    keyword: str = Field(min_length=1, max_length=100)
    limit: int = Field(default=10, ge=1, le=50)


class MaterialLinkIn(BaseModel):
    product_id: int = Field(gt=0)
    note: str = Field(default="", max_length=255)
