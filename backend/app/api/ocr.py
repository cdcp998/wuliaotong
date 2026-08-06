"""OCR 识别接口（《后端API设计.md》§7）：异步识别任务、拍照快查、商品匹配、AI 建议。

- 送货单（ocr_type=1）：异步任务 → RapidOCR 识别 → DeepSeek 结构化（未配置则返回原文行）→ 前端人工确认
- 商品快查（ocr_type=2/3）：同步识别 → 商品库模糊匹配 → 返回候选商品（出入库带入用）
- 未匹配商品 → POST /ocr/match 调豆包视觉 → ai_suggestion → 人工确认新增/忽略
"""
from __future__ import annotations

import json
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import (
    BizError,
    E_BILL_STATUS,
    E_LLM_FAILED,
    E_NOT_FOUND,
    E_OCR_UNAVAILABLE,
    E_PARAM,
    ok,
)
from app.db import SessionLocal, get_db
from app.models.base import BaseCategory, BaseProduct, BaseUnit
from app.models.ocr import AiSuggestion, OcrRecord
from app.models.sys import SysFile, SysStorage, SysUser
from app.services.llm import LLMNotConfigured, get_llm
from app.services.ocr.client import get_ocr_engine
from app.services.storage import resolve_storage_path

router = APIRouter(tags=["OCR/大模型"], dependencies=[Depends(get_current_user)])

# 内存任务表（单机部署足够；多进程需 Redis，暂不引入）
_tasks: dict[str, dict] = {}
_task_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ocr")


def _read_file_bytes(db: Session, file_id: int) -> bytes:
    f = db.get(SysFile, file_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "文件不存在")
    storage = db.get(SysStorage, f.storage_id)
    path = resolve_storage_path(storage) / f.file_path
    if not path.is_file():
        raise BizError(E_NOT_FOUND, "文件已丢失")
    return path.read_bytes()


def _match_products(db: Session, text: str) -> list[dict]:
    """商品库模糊匹配：名称/编码/SKU/条码（去除空白后）。"""
    key = re.sub(r"\s+", "", text)
    if not key:
        return []
    like = f"%{key}%"
    rows = db.scalars(
        select(BaseProduct)
        .where(
            BaseProduct.status == 1,
            or_(
                BaseProduct.name.like(like),
                BaseProduct.code.like(like),
                BaseProduct.sku.like(like),
                BaseProduct.barcode == key,
            ),
        )
        .limit(5)
    ).all()
    return [
        {"product_id": p.id, "code": p.code, "name": p.name, "spec": p.spec, "barcode": p.barcode}
        for p in rows
    ]


def _structured_by_deepseek(db: Session, lines: list[str]) -> dict | None:
    """DeepSeek 将送货单文本行结构化为 JSON 商品行；未配置/失败返回 None（前端人工录入）。"""
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return None
    prompt = (
        "你是送货单识别助手。将以下OCR识别的文字行整理为商品明细，只输出JSON数组，"
        "每项字段：product_name(商品名)、qty(数量字符串)、price(单价字符串)、amount(金额字符串，可空)。"
        "无法判断的项跳过。不要输出其他内容。\n文本行：\n" + "\n".join(lines)
    )
    try:
        content = llm.chat_text("只输出JSON，不要解释", prompt)
        start, end = content.find("["), content.rfind("]")
        if start < 0 or end < 0:
            return None
        items = json.loads(content[start : end + 1])
        return {"items": items[:50]}
    except Exception:
        return None


def _save_record(file_id: int, ocr_type: int, texts: list[str], structured: dict | None, user_id: int) -> int:
    """后台线程独立会话写识别记录（返回 record_id）。"""
    s = SessionLocal()
    try:
        matched = any(_match_products(s, t) for t in texts)
        rec = OcrRecord(
            file_id=file_id, ocr_type=ocr_type, engine="rapidocr",
            raw_result=[{"text": t} for t in texts],
            structured=structured,
            match_status=1 if matched else 2,
            duration_ms=0, user_id=user_id,
        )
        s.add(rec)
        s.commit()
        return rec.id
    finally:
        s.close()


# ============================ 识别任务（异步，送货单） ============================


@router.post("/ocr/recognize", dependencies=[Depends(require_permission("ocr:use"))])
def ocr_recognize(
    file_id: int,
    ocr_type: int = Query(1, ge=1, le=3, description="1 送货单 / 2 商品外包装 / 3 标签型号"),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    data = _read_file_bytes(db, file_id)
    task_id = uuid.uuid4().hex
    with _task_lock:
        _tasks[task_id] = {"status": "running", "record_id": 0, "structured": None, "error": ""}

    def _run() -> None:
        try:
            s_eng = SessionLocal()
            try:
                lines = get_ocr_engine(s_eng).recognize(data)  # 引擎选择读库（后台可切换）
            finally:
                s_eng.close()
            texts = [l.text for l in lines]
            structured = None
            if ocr_type == 1:  # 送货单结构化：后台线程必须用独立会话（不可共享请求级 db）
                s2 = SessionLocal()
                try:
                    structured = _structured_by_deepseek(s2, texts)
                finally:
                    s2.close()
            record_id = _save_record(file_id, ocr_type, texts, structured, user.id)
            with _task_lock:
                _tasks[task_id] = {
                    "status": "done",
                    "record_id": record_id,
                    "structured": structured or {"lines": texts},
                    "error": "",
                }
        except Exception as e:
            with _task_lock:
                _tasks[task_id] = {"status": "failed", "record_id": 0, "structured": None, "error": str(e)}

    _executor.submit(_run)
    return ok({"task_id": task_id})


@router.get("/ocr/tasks/{task_id}")
def ocr_task_status(task_id: str, db: Session = Depends(get_db)) -> dict:
    with _task_lock:
        task = _tasks.get(task_id)
        if task is None:
            raise BizError(E_NOT_FOUND, "任务不存在")
        if task["status"] == "failed":
            raise BizError(E_OCR_UNAVAILABLE, f"识别失败：{task['error']}")
        return ok(task)


# ============================ 拍照快查（同步） ============================


@router.post("/ocr/quick", dependencies=[Depends(require_permission("ocr:use"))])
def ocr_quick(
    file_id: int,
    ocr_type: int = Query(2, ge=2, le=3, description="2 商品外包装 / 3 标签型号"),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """同步识别商品照片并匹配系统商品（出入库带入用）。"""
    data = _read_file_bytes(db, file_id)
    try:
        lines = get_ocr_engine(db).recognize(data)
    except Exception as e:
        raise BizError(E_OCR_UNAVAILABLE, f"识别失败：{e}")
    texts = [l.text for l in lines]
    matches: list[dict] = []
    seen: set[int] = set()
    for t in texts:
        for m in _match_products(db, t):
            if m["product_id"] not in seen:
                seen.add(m["product_id"])
                matches.append(m)
    _save_record(file_id, ocr_type, texts, None, user.id)
    return ok({"lines": texts, "matches": matches})


# ============================ 识别记录 ============================


@router.get("/ocr/records", dependencies=[Depends(require_permission("ocr:manage"))])
def ocr_records(
    match_status: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(OcrRecord)
    if match_status is not None:
        stmt = stmt.where(OcrRecord.match_status == match_status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(OcrRecord.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({
        "list": [
            {
                "id": r.id, "file_id": r.file_id, "ocr_type": r.ocr_type, "engine": r.engine,
                "raw_result": r.raw_result, "structured": r.structured,
                "match_status": r.match_status, "created_at": r.created_at,
            }
            for r in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    })


# ============================ AI 建议（未匹配商品） ============================


@router.post("/ocr/match", dependencies=[Depends(require_permission("ocr:use"))])
def ocr_match(
    record_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """未匹配文本 → 豆包视觉识别商品 → 生成 ai_suggestion（人工确认后新增）。"""
    record = db.get(OcrRecord, record_id)
    if record is None:
        raise BizError(E_NOT_FOUND, "识别记录不存在")
    file_bytes = _read_file_bytes(db, record.file_id)
    try:
        llm = get_llm(db, "doubao")
    except LLMNotConfigured as e:
        raise BizError(5002, str(e))
    prompt = (
        "识别图片中的商品/物料，输出JSON：{\"name\": 商品名称, \"spec\": 规格型号, "
        "\"category\": 类别, \"note\": 其他可识别信息}。无法识别时 name 给最可能的名称。只输出JSON。"
    )
    try:
        content = llm.chat_image(file_bytes, prompt)
    except Exception as e:
        raise BizError(5002, f"豆包识别失败：{e}")
    try:
        start, end = content.find("{"), content.rfind("}")
        parsed = json.loads(content[start : end + 1]) if start >= 0 and end >= 0 else {}
    except Exception:
        parsed = {}
    name = str(parsed.get("name") or "未知商品")[:100]
    suggestion = AiSuggestion(
        ocr_record_id=record.id, product_name=name, model="doubao",
        suggestion={
            "spec": str(parsed.get("spec") or "")[:100],
            "category": str(parsed.get("category") or "")[:50],
            "note": str(parsed.get("note") or "")[:200],
        },
        status=1,  # 待处理
    )
    db.add(suggestion)
    db.commit()
    db.refresh(suggestion)
    return ok({"suggestion_id": suggestion.id, "product_name": name, "detail": parsed})


@router.get("/ai-suggestions", dependencies=[Depends(require_permission("ocr:manage"))])
def ai_suggestions(
    status: int = Query(1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(AiSuggestion).where(AiSuggestion.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AiSuggestion.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return ok({
        "list": [
            {
                "id": r.id, "ocr_record_id": r.ocr_record_id, "product_name": r.product_name,
                "model": r.model, "suggestion": r.suggestion, "status": r.status,
                "new_product_id": r.new_product_id, "created_at": r.created_at,
            }
            for r in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    })


@router.post("/ai-suggestions/{sug_id}/accept", dependencies=[Depends(require_permission("base:product"))])
def ai_suggestion_accept(
    sug_id: int,
    code: str = Query("", max_length=50, description="商品编码，缺省自动生成"),
    name: str = Query("", max_length=100, description="商品名，缺省用 AI 建议名"),
    category_id: int = Query(0),
    unit_id: int = Query(0, description="基本单位，缺省取第一个单位"),
    purchase_price: str = Query("0", max_length=20),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """确认 AI 建议 → 新增商品（人工确认后入库）。"""
    sug = db.get(AiSuggestion, sug_id)
    if sug is None:
        raise BizError(E_NOT_FOUND, "建议不存在")
    if sug.status != 1:
        raise BizError(E_BILL_STATUS, "建议已处理")
    code = code or f"AI{datetime.now().strftime('%Y%m%d%H%M%S')}"
    if db.scalar(select(BaseProduct.id).where(BaseProduct.code == code)):
        raise BizError(E_PARAM, f"商品编码 {code} 已存在")
    unit_id = unit_id or db.scalar(select(BaseUnit.id).order_by(BaseUnit.id).limit(1)) or 0
    if not unit_id:
        raise BizError(E_PARAM, "请先创建计量单位")
    spec = str(sug.suggestion.get("spec") or "") if isinstance(sug.suggestion, dict) else ""
    product = BaseProduct(
        code=code,
        name=name or sug.product_name,
        spec=spec,
        category_id=category_id,
        unit_id=unit_id,
        purchase_price=_parse_price(purchase_price),
    )
    db.add(product)
    db.flush()
    sug.status = 2
    sug.new_product_id = product.id
    sug.handled_by = user.id
    sug.handled_at = datetime.now()
    db.commit()
    return ok({"product_id": product.id, "code": product.code})


@router.post("/ai-suggestions/{sug_id}/ignore", dependencies=[Depends(require_permission("ocr:manage"))])
def ai_suggestion_ignore(
    sug_id: int,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    sug = db.get(AiSuggestion, sug_id)
    if sug is None:
        raise BizError(E_NOT_FOUND, "建议不存在")
    if sug.status != 1:
        raise BizError(E_BILL_STATUS, "建议已处理")
    sug.status = 3
    sug.handled_by = user.id
    sug.handled_at = datetime.now()
    db.commit()
    return ok()


def _parse_price(v: str) -> object:
    from decimal import Decimal, InvalidOperation

    try:
        return Decimal(v)
    except InvalidOperation:
        return Decimal(0)
