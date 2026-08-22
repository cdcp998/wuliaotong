"""knowledge 模块公开服务：已发布知识检索（task 等模块经此调用，不 import models）。"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.knowledge.models import KnowledgeArticle


def search_articles(db: Session, keyword: str, limit: int = 10) -> list[dict]:
    """RAG-lite 关键词检索（仅已发布）：标题/正文/分类/标签 任一命中即返回。"""
    like = f"%{keyword}%"
    rows = db.scalars(
        select(KnowledgeArticle)
        .where(
            KnowledgeArticle.status == 1,
            or_(
                KnowledgeArticle.title.like(like),
                KnowledgeArticle.content.like(like),
                KnowledgeArticle.category.like(like),
                KnowledgeArticle.tags.like(like),
            ),
        )
        .order_by(KnowledgeArticle.updated_at.desc())
        .limit(limit)
    ).all()
    out = []
    for a in rows:
        content = a.content or ""
        idx = content.find(keyword)
        snippet = content[max(0, idx - 60): idx + 120] if idx >= 0 else content[:180]
        out.append({
            "id": a.id,
            "title": a.title,
            "category": a.category,
            "version": a.published_version or a.version,
            "snippet": snippet,
            "published_at": a.published_at.isoformat() if a.published_at else None,
        })
    return out


def articles_by_product(db: Session, product_id: int, limit: int = 20) -> list[dict]:
    """按物料关联取已发布知识条目。"""
    from app.modules.knowledge.models import KnowledgeMaterialLink

    rows = db.scalars(
        select(KnowledgeArticle)
        .join(KnowledgeMaterialLink, KnowledgeMaterialLink.article_id == KnowledgeArticle.id)
        .where(
            KnowledgeArticle.status == 1,
            KnowledgeMaterialLink.product_id == product_id,
        )
        .order_by(KnowledgeArticle.updated_at.desc())
        .limit(limit)
    ).all()
    return [
        {"id": a.id, "title": a.title, "category": a.category, "version": a.published_version or a.version}
        for a in rows
    ]
