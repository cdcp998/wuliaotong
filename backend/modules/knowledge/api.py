"""knowledge 模块接口（知识库 CRUD/版本/审核发布/AI 生成/物料关联/检索，方案 §6.4）。

router 级依赖：require_module_enabled("knowledge")。
可见性（§8.3）：已发布对所有 knowledge:view 角色可见；草稿仅作者 + 审核人（超管/调度员）。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.deps import SUPER_ADMIN_ROLE_CODE, get_current_user, require_permission
from app.core.modules import require_module_enabled
from app.core.response import BizError, E_BILL_STATUS, E_NOT_FOUND, E_PARAM, ok
from app.db import get_db
from app.models import SysRole
from app.models.sys import SysUser
from app.modules.knowledge.models import (
    KnowledgeArticle,
    KnowledgeArticleRevision,
    KnowledgeGenerateTask,
    KnowledgeMaterialLink,
)
from app.modules.knowledge.schemas import (
    ArticleCreate,
    ArticleUpdate,
    GenerateReq,
    MaterialLinkIn,
    SearchReq,
)
from app.modules.knowledge.services.article_search import articles_by_product, search_articles

logger = logging.getLogger("app.knowledge")

router = APIRouter(tags=["知识库"], dependencies=[Depends(get_current_user), Depends(require_module_enabled("knowledge"))])

REVIEW_ROLES = (SUPER_ADMIN_ROLE_CODE, "dispatcher")


def _is_reviewer(db: Session, user: SysUser) -> bool:
    role = db.get(SysRole, user.role_id)
    return (role.code if role else "") in REVIEW_ROLES


def _can_view_article(db: Session, user: SysUser, a: KnowledgeArticle) -> bool:
    if a.status == 1:
        return True
    return a.created_by == user.id or _is_reviewer(db, user)


def _article_out(db: Session, a: KnowledgeArticle, detail: bool = False) -> dict:
    out = {
        "id": a.id,
        "title": a.title,
        "version": a.version,
        "published_version": a.published_version,
        "category": a.category,
        "tags": json.loads(a.tags) if a.tags else [],
        "related_cable_types": json.loads(a.related_cable_types) if a.related_cable_types else [],
        "related_fault_types": json.loads(a.related_fault_types) if a.related_fault_types else [],
        "author_type": a.author_type,
        "status": a.status,
        "source_task_id": a.source_task_id,
        "created_by": a.created_by,
        "published_by": a.published_by,
        "published_at": a.published_at.isoformat() if a.published_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
    if detail:
        out["content"] = a.content
    return out


def _save_article_fields(a: KnowledgeArticle, data: dict) -> None:
    for k in ("title", "content", "category"):
        if k in data and data[k] is not None:
            setattr(a, k, data[k])
    for k, col in (
        ("tags", "tags"), ("related_cable_types", "related_cable_types"), ("related_fault_types", "related_fault_types"),
    ):
        if k in data and data[k] is not None:
            setattr(a, col, json.dumps(data[k], ensure_ascii=False))


# ============================ 知识条目 ============================

@router.get("/knowledge", dependencies=[Depends(require_permission("knowledge:view"))])
def list_articles(
    status: str = "",
    category: str = "",
    keyword: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(KnowledgeArticle)
    if not _is_reviewer(db, user):
        stmt = stmt.where(or_(KnowledgeArticle.status == 1, KnowledgeArticle.created_by == user.id))
    elif status:
        stmt = stmt.where(KnowledgeArticle.status == int(status))
    if category:
        stmt = stmt.where(KnowledgeArticle.category == category)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(KnowledgeArticle.title.like(like) | KnowledgeArticle.content.like(like))
    from sqlalchemy import func

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(KnowledgeArticle.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({"total": total, "page": page, "page_size": page_size, "items": [_article_out(db, a) for a in rows]})


@router.get("/knowledge/{article_id}", dependencies=[Depends(require_permission("knowledge:view"))])
def get_article(article_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    a = db.get(KnowledgeArticle, article_id)
    if a is None or not _can_view_article(db, user, a):
        raise BizError(E_NOT_FOUND, "知识不存在或不可见")
    return ok(_article_out(db, a, detail=True))


@router.post("/knowledge", dependencies=[Depends(require_permission("knowledge:write"))])
def create_article(req: ArticleCreate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    a = KnowledgeArticle(
        title=req.title, content=req.content, category=req.category, author_type="manual",
        created_by=user.id, status=0,
    )
    _save_article_fields(a, {"tags": req.tags, "related_cable_types": req.related_cable_types, "related_fault_types": req.related_fault_types})
    db.add(a)
    db.commit()
    db.refresh(a)
    return ok(_article_out(db, a))


@router.put("/knowledge/{article_id}", dependencies=[Depends(require_permission("knowledge:write"))])
def update_article(article_id: int, req: ArticleUpdate, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    a = db.get(KnowledgeArticle, article_id)
    if a is None:
        raise BizError(E_NOT_FOUND, "知识不存在")
    if a.status == 2:
        raise BizError(E_BILL_STATUS, "已归档知识不可编辑")
    data = req.model_dump(exclude_none=True)
    _save_article_fields(a, data)
    # 已发布内容被修改 → 回到草稿（发布快照保留在 revision，待重新审核发布）
    if a.status == 1:
        a.status = 0
        a.version += 1
    elif a.status == 0 and data.get("content") is not None:
        a.version += 1
    db.commit()
    return ok(_article_out(db, a))


@router.post("/knowledge/{article_id}/publish", dependencies=[Depends(require_permission("knowledge:review"))])
def publish_article(article_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    a = db.get(KnowledgeArticle, article_id)
    if a is None:
        raise BizError(E_NOT_FOUND, "知识不存在")
    if a.status == 2:
        raise BizError(E_BILL_STATUS, "已归档知识不可发布")
    if a.status == 1 and a.published_version == a.version:
        return ok(_article_out(db, a))
    if a.status == 1 and a.published_version != a.version:
        raise BizError(E_BILL_STATUS, "内容已变更待重新发布（编辑已自动转为草稿）")
    # 版本快照 + 发布
    db.add(KnowledgeArticleRevision(
        article_id=a.id, version=a.version, title=a.title, content=a.content,
        status=1, created_by=user.id,
    ))
    a.published_version = a.version
    a.status = 1
    a.published_by = user.id
    a.published_at = datetime.now()
    db.commit()
    return ok(_article_out(db, a))


@router.post("/knowledge/{article_id}/archive", dependencies=[Depends(require_permission("knowledge:review"))])
def archive_article(article_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    a = db.get(KnowledgeArticle, article_id)
    if a is None:
        raise BizError(E_NOT_FOUND, "知识不存在")
    if a.status == 2:
        return ok(_article_out(db, a))
    db.add(KnowledgeArticleRevision(
        article_id=a.id, version=a.version, title=a.title, content=a.content,
        status=2, created_by=user.id,
    ))
    a.status = 2
    db.commit()
    return ok(_article_out(db, a))


# ============================ AI 生成（异步） ============================

@router.post("/knowledge/generate", dependencies=[Depends(require_permission("knowledge:write"))])
def generate(req: GenerateReq, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """AI 生成：异步入队返回 task_id；前端轮询 GET /knowledge/generate/{task_id}。"""
    task = KnowledgeGenerateTask(
        status="queued",
        input=json.dumps(req.model_dump(), ensure_ascii=False),
        created_by=user.id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return ok({"task_id": task.id})


@router.get("/knowledge/generate/{task_id}", dependencies=[Depends(require_permission("knowledge:view"))])
def generate_status(task_id: int, user: SysUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    t = db.get(KnowledgeGenerateTask, task_id)
    if t is None:
        raise BizError(E_NOT_FOUND, "生成任务不存在")
    if t.created_by != user.id and not _is_reviewer(db, user):
        raise BizError(4005, "仅创建人或审核人可查看生成任务", http_status=403)
    try:
        inp = json.loads(t.input)
    except (TypeError, ValueError):
        inp = {}
    return ok({
        "task_id": t.id,
        "status": t.status,
        "topic": inp.get("topic", ""),
        "article_id": t.article_id or None,
        "model": t.model,
        "last_error": t.last_error,
        "retry_count": t.retry_count,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "finished_at": t.finished_at.isoformat() if t.finished_at else None,
    })


# ============================ 物料关联 / 检索 ============================

@router.get("/knowledge/materials/{product_id}", dependencies=[Depends(require_permission("knowledge:view"))])
def materials_knowledge(product_id: int, db: Session = Depends(get_db)) -> dict:
    return ok({"items": articles_by_product(db, product_id)})


@router.post("/knowledge/{article_id}/materials", dependencies=[Depends(require_permission("knowledge:write"))])
def link_material(article_id: int, req: MaterialLinkIn, db: Session = Depends(get_db)) -> dict:
    a = db.get(KnowledgeArticle, article_id)
    if a is None:
        raise BizError(E_NOT_FOUND, "知识不存在")
    from app.models import BaseProduct

    if db.get(BaseProduct, req.product_id) is None:
        raise BizError(E_NOT_FOUND, "物料不存在")
    exists = db.scalar(select(KnowledgeMaterialLink.id).where(
        KnowledgeMaterialLink.article_id == article_id, KnowledgeMaterialLink.product_id == req.product_id,
    ))
    if exists:
        return ok({"duplicate": True})
    db.add(KnowledgeMaterialLink(article_id=article_id, product_id=req.product_id, note=req.note))
    db.commit()
    return ok({"duplicate": False})


@router.post("/knowledge/search", dependencies=[Depends(require_permission("knowledge:view"))])
def search(req: SearchReq, db: Session = Depends(get_db)) -> dict:
    return ok({"items": search_articles(db, req.keyword, req.limit)})
