"""OCR 识别接口（《后端API设计.md》§7）：异步识别任务、拍照快查、商品匹配、AI 建议。

- 送货单（ocr_type=1）：异步任务 → RapidOCR 识别 → DeepSeek 结构化（未配置则返回原文行）→ 前端人工确认
- 商品快查（ocr_type=2/3）：同步识别 → 商品库模糊匹配 → 返回候选商品（出入库带入用）
- 未匹配商品 → POST /ocr/match 调豆包视觉 → ai_suggestion → 人工确认新增/忽略
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

logger = logging.getLogger("app.ocr")

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_permission
from app.core.response import (
    BizError,
    E_BILL_STATUS,
    E_LLM_FAILED,
    E_NOT_FOUND,
    E_NO_PERMISSION,
    E_OCR_UNAVAILABLE,
    E_PARAM,
    ok,
)
from app.db import SessionLocal, get_db
from app.models.base import BaseCategory, BaseProduct, BaseSupplier, BaseUnit
from app.models.ocr import AiSuggestion, OcrRecord
from app.models.sys import SysFile, SysRole, SysStorage, SysUser
from app.schemas.ocr import ClassifyReq, DeliveryConfirmReq
from app.services.llm import LLMNotConfigured, get_llm
from app.services.ocr.barcode import try_decode_barcode
from app.services.ocr.client import OCRInitError, get_ocr_engine
from app.services.ocr.correction import correct_texts
from app.services.ocr.generic_parser import is_footer_text, parse_delivery_generic, sanitize_items
from app.services.ocr.template import parse_delivery as parse_delivery_template
from app.services.ai.supplier_norm import match_supplier_by_llm
from app.services.ocr.product_template import build_anchors, load_templates, match_template, save_templates
from app.services.storage import resolve_storage_path

router = APIRouter(tags=["OCR/大模型"], dependencies=[Depends(get_current_user)])

# 内存任务表（单机部署足够；多进程需 Redis，暂不引入）
_tasks: dict[str, dict] = {}
_task_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ocr")
_TASK_TTL_SECONDS = 3600  # 任务结果保留 1 小时，之后惰性清理（防任务表无界增长）
_MAX_TASKS = 500  # 任务表容量上限（防止恶意刷识别任务导致内存耗尽）


def _cleanup_tasks_locked(now: float) -> None:
    """清理过期任务；超容量时淘汰最旧任务。必须在 _task_lock 内调用。"""
    for task_id in list(_tasks.keys()):
        created = _tasks[task_id].get("created_at", 0.0)
        if now - created > _TASK_TTL_SECONDS:
            del _tasks[task_id]
    if len(_tasks) > _MAX_TASKS:
        for task_id in sorted(_tasks, key=lambda k: _tasks[k].get("created_at", 0.0))[:_MAX_TASKS // 5]:
            del _tasks[task_id]


def _read_file_bytes(db: Session, file_id: int, user: SysUser) -> bytes:
    """按 file_id 读取上传文件；校验归属防止 IDOR（普通用户只能读取自己上传的文件，
    超管/管理者/仓管员与 /files/{id} 下载接口的访问语义保持一致）。"""
    f = db.get(SysFile, file_id)
    if f is None:
        raise BizError(E_NOT_FOUND, "文件不存在")
    role = db.get(SysRole, user.role_id)
    if f.uploader_id != user.id and not (role and role.code in ("super_admin", "manager", "storekeeper")):
        raise BizError(E_NO_PERMISSION, "无权访问该文件", http_status=403)
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


VISION_DELIVERY_PROMPT = (
    "你是送货单识别助手。请识别图片中的送货单，只输出一个 JSON 对象，不要解释。"
    "字段：ocr_text(图片中全部文字，按阅读顺序用换行分隔)、supplier_name(供应商名称，可空字符串)、"
    "bill_no(送货单号/单据编号，可空字符串)、items(商品明细数组，每项：product_name(商品名)、"
    "material_code(物料编码，可空)、spec(规格型号，可空)、unit(单位，可空)、qty(数量字符串)、"
    "price(单价字符串)、amount(金额字符串，可空))。"
    "注意：单据下方的合计行/总计/大写金额（如「合计 84460.00」「大写：捌万肆仟肆佰陆拾元整」）"
    "不是商品明细，不要输出为 items；每条明细单独一项，数量/单价/金额分别输出，不要合并；"
    "无法判断的项留空或跳过。"
)

VISION_TEXT_PROMPT = (
    "你是文字识别助手。识别图片中的所有文字（商品名称、规格、型号、编号等），"
    "按阅读顺序每行一条输出，只输出识别到的文字行，不要解释。"
)

VISION_PRODUCT_PROMPT = (
    "你是商品识别助手。识别图片中商品包装/标签上的商品信息，只输出一个 JSON 对象，不要解释。"
    "字段：product_name(商品名称，如「8口千兆以太网交换机」)、brand(品牌，如「H3C」，可空)、"
    "spec(规格型号，如「S2G Pro」，可空)、lines(图片中全部文字，按阅读顺序用换行分隔)。"
    "无法判断的字段留空。"
)


def _local_ocr(db: Session, data: bytes) -> list[str] | None:
    """本地 OCR 引擎识别（纯文本）；引擎关闭/失败返回 None（走视觉兜底）。"""
    lines = _local_ocr_lines(db, data)
    return [l.text for l in lines] if lines is not None else None


def _local_ocr_lines(db: Session, data: bytes) -> list | None:
    """本地 OCR 引擎识别（带坐标 OcrLine）；引擎已关闭（ocr.engine=off）、启动失败或识别失败均返回 None
    （走视觉兜底或统一 5001 错误，避免引擎异常堆 500 / 请求卡死）。"""
    try:
        return get_ocr_engine(db).recognize(data)
    except (ValueError, OCRInitError):
        return None


def _sanitize_structured(structured: dict) -> None:
    """容错校验（所有识别来源通用）：剔表头/合计/无名称/异常数值行，数值归一。"""
    items, warns = sanitize_items(structured.get("items") or [])
    structured["items"] = items
    if warns:
        structured["warnings"] = structured.get("warnings") or []
        structured["warnings"].extend(warns)


def _vision_product(db: Session, image_bytes: bytes) -> dict | None:
    """视觉模型识别商品外包装/标签 → 结构化 {product_name, brand, spec, lines}。

    兜底链 SiliconFlow → 豆包；未配置/未启用/调用失败/解析失败返回 None（调用方回退纯文本）。
    """
    for name in ("siliconflow", "doubao"):
        try:
            vllm = get_llm(db, name)
        except LLMNotConfigured:
            continue
        try:
            content = vllm.chat_image(image_bytes, VISION_PRODUCT_PROMPT, scene="vision_product")
            start, end = content.find("{"), content.rfind("}")
            if start < 0 or end < 0:
                continue
            obj = json.loads(content[start : end + 1])
            if not isinstance(obj, dict):
                continue
            return {
                "product_name": str(obj.get("product_name") or "").strip(),
                "brand": str(obj.get("brand") or "").strip(),
                "spec": str(obj.get("spec") or "").strip(),
                "lines": [ln.strip() for ln in str(obj.get("lines") or "").splitlines() if ln.strip()],
            }
        except Exception:  # noqa: BLE001 网络/鉴权/解析失败 → 尝试下一个视觉模型
            continue
    return None


def _vision_texts(db: Session, data: bytes) -> list[str]:
    """视觉模型纯文本识别兜底（SiliconFlow → 豆包）；全部不可用返回空列表。"""
    for name in ("siliconflow", "doubao"):
        try:
            vllm = get_llm(db, name)
        except LLMNotConfigured:
            continue
        try:
            content = vllm.chat_image(data, VISION_TEXT_PROMPT, scene="vision_text")
            return [ln.strip() for ln in content.splitlines() if ln.strip()]
        except Exception:  # noqa: BLE001
            continue
    return []


def _recognize_text(db: Session, data: bytes) -> list[str]:
    """商品外包装/标签识别：本地 OCR 引擎优先；本地引擎关闭时回退视觉模型。

    视觉兜底链：结构化商品识别（product_name/brand/spec，利于匹配）→ 纯文本行；
    全部不可用时抛 BizError，提示「识别功能不可用」。
    """
    local = _local_ocr(db, data)
    if local is not None:
        return local
    prod = _vision_product(db, data)
    if prod and prod.get("lines"):
        return prod["lines"]
    texts = _vision_texts(db, data)
    if texts:
        return texts
    raise BizError(
        E_OCR_UNAVAILABLE,
        "识别功能不可用：本地 OCR 识别引擎已关闭，且视觉模型（SiliconFlow/豆包）均不可用（系统设置 → OCR 与大模型）",
    )


def _delivery_by_vision(db: Session, image_bytes: bytes) -> dict | None:
    """SiliconFlow 视觉模型识别送货单图片 → 结构化（含 OCR 原文行）。未配置/失败返回 None。"""
    try:
        vllm = get_llm(db, "siliconflow")
    except LLMNotConfigured:
        return None
    try:
        content = vllm.chat_image(image_bytes, VISION_DELIVERY_PROMPT, scene="vision_delivery")
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end < 0:
            return None
        data = json.loads(content[start : end + 1])
        if not isinstance(data, dict):
            return None
        lines = [ln.strip() for ln in str(data.get("ocr_text") or "").splitlines() if ln.strip()]
        items = (data.get("items") or [])[:50]
        return {
            "supplier_name": str(data.get("supplier_name") or "").strip(),
            "bill_no": str(data.get("bill_no") or "").strip(),
            "items": items,
            "lines": lines,
        }
    except Exception:
        return None


def _classify_items_by_deepseek(db: Session, items: list) -> list:
    """DeepSeek 对视觉识别结果做材料分类（补 category_name）；未配置/失败返回原样。"""
    if not items:
        return items
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return items
    cats = [c.name for c in db.scalars(select(BaseCategory).order_by(BaseCategory.sort, BaseCategory.id)).all()]
    # 过滤测试/乱码分类（带 6 位十六进制随机后缀，如「标准件f9d3ae」），避免干扰大模型分类判断
    cats = [n for n in cats if not re.match(r"^.{1,6}[0-9a-f]{6}$", n)]
    prompt = (
        "你是材料分类助手。系统材料分类："
        + (", ".join(cats) if cats else "（暂无分类，全部输出未分类）")
        + "。为每条材料选择最合适的分类名（都不匹配输出\"未分类\"）。"
        + "输入与输出均为 JSON items 数组（每项 product_name/qty/price 等原样保留，新增 category_name）。只输出 JSON。"
        + json.dumps(items, ensure_ascii=False)
    )
    try:
        content = llm.chat_text("只输出JSON，不要解释", prompt, scene="classify_items")
        start, end = content.find("["), content.rfind("]")
        if start < 0 or end < 0:
            return items
        classified = json.loads(content[start : end + 1])
        if isinstance(classified, list) and len(classified) == len(items):
            return [
                {**it, "category_name": str(c.get("category_name") or "未分类").strip()}
                for it, c in zip(items, classified)
            ]
    except Exception:
        pass
    return items


def _structured_by_deepseek(db: Session, lines: list[str]) -> dict | None:
    """DeepSeek 将送货单文本行结构化为 JSON；未配置/失败返回 None（前端人工录入）。

    返回：{"supplier_name": 供应商(可空), "bill_no": 送货单号(可空),
           "items": [{product_name, material_code(可空), spec(可空), qty, price, amount}]}
    """
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return None
    prompt = (
        "你是送货单识别助手。将以下OCR识别的文字行整理为结构化JSON对象，只输出JSON，不要解释。\n"
        "对象字段：supplier_name(供应商名称，可空字符串)、bill_no(单据编号/订单编号，可空字符串)、"
        "items(商品明细数组，每项：product_name(商品名)、material_code(物料编码，可空)、"
        "spec(规格型号，可空)、qty(数量字符串)、price(单价字符串)、amount(金额字符串，可空))。\n"
        "无法判断的项留空或跳过。\n文本行：\n" + "\n".join(lines)
    )
    try:
        content = llm.chat_text("只输出JSON，不要解释", prompt, scene="structured")
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end < 0:
            return None
        data = json.loads(content[start : end + 1])
        if not isinstance(data, dict):
            return None
        items = data.get("items") or []
        return {
            "supplier_name": str(data.get("supplier_name") or "").strip(),
            "bill_no": str(data.get("bill_no") or "").strip(),
            "items": items[:50],
        }
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
    mode: str = Query("auto", description="auto 四级回退（模板→通用提取→视觉→DeepSeek）；template 仅本地；llm 仅大模型"),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    # 四级回退链在后台任务 _run 内按 mode 执行（见《后端API设计.md》§7 /ocr/recognize）
    if mode not in ("auto", "template", "llm"):
        raise BizError(E_PARAM, "mode 必须为 auto/template/llm")
    data = _read_file_bytes(db, file_id, user)
    task_id = uuid.uuid4().hex
    with _task_lock:
        _cleanup_tasks_locked(time.monotonic())
        _tasks[task_id] = {"status": "running", "record_id": 0, "structured": None, "error": "", "created_at": time.monotonic()}

    def _run() -> None:
        try:
            s_eng = SessionLocal()
            try:
                texts: list[str] = []
                structured = None
                if ocr_type == 1:
                    # 送货单四级回退（mode=auto）：① 规则模板（已知格式）→ ② 通用字段提取（未知格式，坐标列识别）
                    # → ③ SiliconFlow 视觉结构化 → ④ DeepSeek 文本结构化；各级结果统一过容错校验
                    ocr_lines = _local_ocr_lines(s_eng, data)
                    texts = [l.text for l in ocr_lines] if ocr_lines else []
                    boxes = [l.box for l in ocr_lines] if ocr_lines else None
                    structured = None
                    if mode in ("auto", "template"):
                        structured = parse_delivery_template(texts)
                        if structured:
                            structured["_engine"] = "template"
                        else:
                            structured = parse_delivery_generic(texts, boxes)
                            if structured:
                                structured["_engine"] = "generic"
                        if structured:
                            _sanitize_structured(structured)
                    if structured is None and mode in ("auto", "llm"):
                        structured = _delivery_by_vision(s_eng, data)
                        if structured:
                            structured.setdefault("_engine", "siliconflow+deepseek")
                            _sanitize_structured(structured)
                    if structured is None and mode in ("auto", "llm") and texts:
                        structured = _structured_by_deepseek(s_eng, texts)
                        if structured:
                            structured["_engine"] = "deepseek"
                            _sanitize_structured(structured)
                    if structured:
                        if not structured.get("lines"):
                            structured["lines"] = texts
                        if not texts and structured.get("lines"):
                            texts = structured["lines"]  # 纯视觉模式：识别记录原文用视觉返回行
                        structured["items"] = _classify_items_by_deepseek(s_eng, structured.get("items") or [])
                    else:
                        structured = {"lines": texts}
                    # 训练样本归档：识别结果补写（best-effort，失败不影响主流程）
                    from app.services.ocr.sample_archive import write_delivery_sample_result

                    write_delivery_sample_result(file_id, structured, ocr_type)
                else:
                    # 商品外包装/标签型号：本地 OCR 优先，本地关闭时回退视觉模型
                    texts = _recognize_text(s_eng, data)
            finally:
                s_eng.close()
            record_id = _save_record(file_id, ocr_type, texts, structured, user.id)
            with _task_lock:
                _cleanup_tasks_locked(time.monotonic())
                _tasks[task_id] = {
                    "status": "done",
                    "record_id": record_id,
                    "structured": structured or {"lines": texts},
                    "error": "",
                    "created_at": time.monotonic(),
                }
            logger.info("OCR 任务完成 task=%s type=%s record_id=%s items=%s lines=%s", task_id, ocr_type, record_id, len((structured or {}).get("items") or []), len(texts))
        except Exception as e:
            logger.error("OCR 任务失败 task=%s type=%s: %s", task_id, ocr_type, e, exc_info=True)
            with _task_lock:
                _cleanup_tasks_locked(time.monotonic())
                _tasks[task_id] = {"status": "failed", "record_id": 0, "structured": None, "error": str(e), "created_at": time.monotonic()}

    logger.info("OCR 任务开始 task=%s file_id=%s type=%s mode=%s user=%s", task_id, file_id, ocr_type, mode, user.username)
    _executor.submit(_run)
    return ok({"task_id": task_id})


@router.get("/ocr/tasks/{task_id}")
def ocr_task_status(task_id: str, db: Session = Depends(get_db)) -> dict:
    with _task_lock:
        _cleanup_tasks_locked(time.monotonic())
        task = _tasks.get(task_id)
        if task is None:
            raise BizError(E_NOT_FOUND, "任务不存在")
        if task["status"] == "failed":
            raise BizError(E_OCR_UNAVAILABLE, f"识别失败：{task['error']}")
        return ok(task)


# ============================ 拍照快查（同步） ============================


def _guess_product_name_from_lines(db: Session, texts: list[str]) -> str | None:
    """文本分析兜底：DeepSeek 从识别文本行中提取最可能的商品名称（判断物品是什么）。

    仅当条码未命中且文本行也匹配不到商品时调用；未配置/调用失败/无法判断返回 None
    （调用方保持原匹配结果，不阻断主流程）。
    """
    try:
        llm = get_llm(db, "deepseek")
    except LLMNotConfigured:
        return None
    prompt = (
        "以下是从商品包装/标签图片识别出的文本行，请判断哪一行（或哪几行组合）是商品名称"
        "（可能是品牌+型号/规格的组合）。只输出商品名称本身，不要解释，不要输出其他行。"
        "若无法判断，输出「无」。\n文本行：\n" + "\n".join(texts)
    )
    try:
        content = llm.chat_text("只输出商品名称，不要解释", prompt, scene="ocr_guess_name")
    except Exception:  # noqa: BLE001 网络/鉴权/解析失败 → 保持原匹配结果
        return None
    name = content.strip().strip('"').strip()
    if not name or name == "无" or len(name) > 100:
        return None
    return name


@router.post("/ocr/quick", dependencies=[Depends(require_permission("ocr:use"))])
def ocr_quick(
    file_id: int,
    ocr_type: int = Query(2, ge=2, le=3, description="2 商品外包装 / 3 标签型号"),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """同步识别商品照片并匹配系统商品（出入库带入用）。

    识别链路（按序执行，每级失败/未命中自动进入下一级）：
    ① 条码解码（zxing-cpp）→ 条码命中商品库直接返回；
    ② 本地 OCR + 纠错 + 模板匹配（结构化 product_name/brand/spec）；
    ③ 视觉模型识别物品（SiliconFlow → 豆包兜底链）；
    ④ 未识别出物品 → 提取文字行（本地 OCR 失败时视觉纯文本兜底）→ 文本匹配，
       仍无匹配则 DeepSeek 从文本行分析物品名称再匹配；
    ⑤ 全部不可用 → 统一 5001 提示。
    """
    data = _read_file_bytes(db, file_id, user)
    prod: dict | None = None
    texts: list[str] = []

    # ① 条码优先：图片含条码且商品库精确命中 → 直接返回（不走 OCR，秒级）
    barcode = try_decode_barcode(data)
    if barcode:
        hit = db.scalars(
            select(BaseProduct).where(BaseProduct.status == 1, BaseProduct.barcode == barcode).limit(1)
        ).first()
        if hit is not None:
            record_id = _save_record(file_id, ocr_type, [], None, user.id)
            return ok({
                "lines": [],
                "barcode": barcode,
                "record_id": record_id,
                "matches": [
                    {"product_id": hit.id, "code": hit.code, "name": hit.name, "spec": hit.spec, "barcode": hit.barcode}
                ],
            })

    # ② 本地 OCR + 模板匹配：文本纠错归一（DeepSeek，失败原样）→ 模板命中直接用结构化字段（秒级）
    local = _local_ocr(db, data)
    if local is not None:
        texts = correct_texts(db, local)
        tpl = match_template(db, texts)
        if tpl:
            prod = {
                "product_name": tpl.get("product_name") or "",
                "brand": tpl.get("brand") or "",
                "spec": tpl.get("spec") or "",
                "lines": texts,
            }
    # ③ 视觉模型识别物品：模板未命中或本地 OCR 不可用 → 结构化商品识别（product_name/brand/spec）
    if prod is None:
        prod = _vision_product(db, data)
        if prod and prod.get("lines"):
            texts = prod["lines"]
    # ④ 未识别出物品 → 提取文字分析：本地 OCR 失败时用视觉纯文本提取；都没有则识别功能不可用
    if not texts:
        texts = _vision_texts(db, data)
        if not texts:
            raise BizError(E_OCR_UNAVAILABLE, "识别功能不可用：本地 OCR 识别引擎已关闭，且视觉模型（SiliconFlow/豆包）均不可用（系统设置 → OCR 与大模型）")
    matches: list[dict] = []
    seen: set[int] = set()
    # 视觉/模板结构化候选优先匹配：商品名 / 品牌+规格 / 规格（比整行宣传文案更易命中）
    candidates: list[str] = []
    if prod:
        if prod.get("product_name"):
            candidates.append(prod["product_name"])
        if prod.get("brand") and prod.get("spec"):
            candidates.append(f"{prod['brand']} {prod['spec']}")
        if prod.get("spec"):
            candidates.append(prod["spec"])
    for t in [*candidates, *texts]:
        for m in _match_products(db, t):
            if m["product_id"] not in seen:
                seen.add(m["product_id"])
                matches.append(m)
                # 模板自动学习：同一商品 3 次命中同一行 → 自动生成模板（下次秒级匹配，不调大模型）
                _maybe_learn_template(db, m["product_id"], t, m.get("spec") or "")
    # ④b 文本分析物品是什么：条码未命中、文本行也匹配不到 → DeepSeek 提取商品名再匹配一次
    if not matches and texts:
        guessed = _guess_product_name_from_lines(db, texts)
        if guessed:
            for m in _match_products(db, guessed):
                if m["product_id"] not in seen:
                    seen.add(m["product_id"])
                    matches.append(m)
    record_id = _save_record(file_id, ocr_type, texts, None, user.id)
    return ok({"lines": texts, "matches": matches, "record_id": record_id, "barcode": barcode or ""})


# ============================ 条形码解码 ============================


@router.post("/barcode/decode", dependencies=[Depends(require_permission("ocr:use"))])
def barcode_decode(
    file_id: int = Query(..., description="已上传图片文件 id"),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """解码图片中的条形码/二维码（zxing-cpp），返回条码值供材料查询。"""
    from app.services.ocr.barcode import decode_barcode

    data = _read_file_bytes(db, file_id, user)
    value = decode_barcode(data)
    return ok({"barcode": value})


# ============================ 材料分类识别（大模型） ============================


@router.post("/ocr/classify", dependencies=[Depends(require_permission("pch:in"))])
def classify_product(req: ClassifyReq, db: Session = Depends(get_db)) -> dict:
    """根据材料名称+规格用 DeepSeek 判断系统分类（材料入库明细行「分类」自动识别）。

    - 识别成功且命中系统分类：{category_id, category_name, matched: true}
    - 识别成功但无匹配分类：{category_id: 0, category_name: "", matched: false}（前端提示手动选择）
    - 大模型未配置/调用失败：4006（前端提示「文本模型未配置/不可用」）
    """
    name = req.name.strip()
    if not name:
        raise BizError(E_PARAM, "材料名称不能为空")
    items = [{"product_name": name, "spec": req.spec.strip(), "qty": "", "price": "", "amount": ""}]
    classified = _classify_items_by_deepseek(db, items)
    cat_name = ""
    if classified and isinstance(classified, list):
        cat_name = str(classified[0].get("category_name") or "").strip()
    if not cat_name or cat_name == "未分类":
        # 无 category_name 说明大模型未配置/调用失败；「未分类」说明识别成功但无匹配
        if not cat_name:
            raise BizError(E_LLM_FAILED, "大模型分类不可用：请先在系统设置中配置并启用文本模型（DeepSeek），或稍后重试")
        return ok({"category_id": 0, "category_name": "", "matched": False})
    cat = db.scalar(select(BaseCategory).where(BaseCategory.name == cat_name).order_by(BaseCategory.id))
    if cat is None:
        # 识别成功但系统无该分类：返回建议名供前端提示（category_id=0 表示未命中，用户可手动选择）
        return ok({"category_id": 0, "category_name": cat_name, "matched": False})
    return ok({"category_id": cat.id, "category_name": cat.name, "matched": True})


# ============================ 本地 OCR 商品识别模板（视觉大模型训练） ============================

# 模板自动学习：quick 匹配成功时记录命中行（product_id → 最近 3 次指纹）；同一商品 3 次稳定命中自动生成模板。
# 内存态（单进程部署足够，重启丢失可重新积累）；每商品生成后清空计数。
_tpl_learn: dict[int, list[str]] = {}


def _maybe_learn_template(db: Session, product_id: int, anchor: str, spec: str = "") -> None:
    """quick 匹配成功时调用：同一商品累计 3 次命中同一行文本 → 自动生成/更新模板（auto=True）。

    手动训练模板（auto 为空）同锚点时不覆盖（手动优先）。
    """
    if not product_id or not anchor:
        return
    key = anchor.replace(" ", "").replace("\u3000", "")
    if len(key) < 4:
        return
    if len(_tpl_learn) >= 2000:
        _tpl_learn.clear()  # 总量有界：超过 2000 个商品时整体重置，模板已落库不受影响
    hits = _tpl_learn.setdefault(product_id, [])
    hits.append(key)
    if len(hits) > 3:
        hits.pop(0)
    # 3 次命中且文本稳定（3 次中至少 2 次相同指纹）才自动生成，防抖动误训练
    if len(hits) < 3 or len(set(hits)) > 2:
        return
    p = db.get(BaseProduct, product_id)
    if p is None:
        return
    anchors = [anchor]
    tpl = {
        "id": uuid.uuid4().hex[:8],
        "name": p.name,
        "brand": "",
        "product_name": p.name,
        "spec": spec,
        "anchors": anchors,
        "auto": True,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    # 同锚点：仅替换 auto 模板；手动训练模板（auto 为空）保留（手动优先）
    templates = [t for t in load_templates(db) if not (t.get("anchors") == anchors and t.get("auto"))]
    templates.append(tpl)
    save_templates(db, templates)
    _tpl_learn[product_id] = []  # 已生成，重置计数（后续可再积累新文本）


@router.post("/ocr/template/train", dependencies=[Depends(require_permission("ocr:manage"))])
def train_product_template(
    file_id: int = Query(...),
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """用视觉大模型识别样本图生成本地 OCR 识别模板（锚点=品牌/规格/商品名）。

    之后同类图片走本地 OCR 时按模板秒级结构化匹配，无需再调大模型；锚点完全相同则覆盖旧模板。
    """
    data = _read_file_bytes(db, file_id, user)
    prod = _vision_product(db, data)
    if not prod or not (prod.get("product_name") or prod.get("spec")):
        raise BizError(E_LLM_FAILED, "训练失败：视觉模型未能识别出商品名称/规格，请换一张更清晰的图片")
    anchors = build_anchors(prod)
    if not anchors:
        raise BizError(E_LLM_FAILED, "训练失败：未能提取到有效锚点（品牌/规格/名称）")
    tpl = {
        "id": uuid.uuid4().hex[:8],
        "name": prod.get("product_name") or prod.get("spec") or "未命名模板",
        "brand": prod.get("brand") or "",
        "product_name": prod.get("product_name") or "",
        "spec": prod.get("spec") or "",
        "anchors": anchors,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    templates = [t for t in load_templates(db) if t.get("anchors") != anchors]
    templates.append(tpl)
    save_templates(db, templates)
    return ok(tpl)


@router.get("/ocr/templates", dependencies=[Depends(require_permission("ocr:manage"))])
def list_product_templates(db: Session = Depends(get_db)) -> dict:
    """本地 OCR 商品识别模板列表。"""
    return ok({"templates": load_templates(db)})


@router.delete("/ocr/templates/{tpl_id}", dependencies=[Depends(require_permission("ocr:manage"))])
def delete_product_template(tpl_id: str, db: Session = Depends(get_db)) -> dict:
    """删除本地 OCR 商品识别模板（按 id）。"""
    templates = load_templates(db)
    remain = [t for t in templates if t.get("id") != tpl_id]
    if len(remain) == len(templates):
        raise BizError(E_NOT_FOUND, "模板不存在")
    save_templates(db, remain)
    return ok()


# ============================ 送货单确认（供应商落库） ============================


@router.post("/ocr/delivery/confirm", dependencies=[Depends(require_permission("pch:in"))])
def delivery_confirm(
    req: DeliveryConfirmReq,
    user: SysUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """送货单 OCR 人工确认：供应商落库 + 物料自动匹配/新增 + 识别记录回写。

    - 供应商：同名匹配，无则自动创建（OCR+日期编码）
    - 物料：物料编码/名称精确匹配系统材料；不存在则用识别数据自动新增（单位自动匹配/创建）
    - 返回 items（含 product_id）供「新建入库」直接带入，单据通过 ocr_record_id 关联送货单
    """
    supplier_id = 0
    supplier_created = False
    supplier_matched_name = ""  # AI 别名归一命中的已有供应商名（前端提示已关联）
    supplier_name = req.supplier_name.strip()
    if supplier_name:
        sup = db.scalar(select(BaseSupplier).where(BaseSupplier.name == supplier_name).order_by(BaseSupplier.id.desc()))
        if sup is None:
            # AI 别名归一：精确匹配失败时用 DeepSeek 判断是否与已有供应商同一实体（简称/全称/错字）
            matched_id, matched_name = match_supplier_by_llm(db, supplier_name)
            if matched_id:
                sup = db.get(BaseSupplier, matched_id)
                supplier_matched_name = matched_name
        if sup is None:
            # 自动编码：OCR + yyyymmdd + 4 位当日序号（复用序号则递增重试）
            prefix = "OCR" + datetime.now().strftime("%Y%m%d")
            codes = db.scalars(select(BaseSupplier.code).where(BaseSupplier.code.like(prefix + "%"))).all()
            seq = max((int(c[len(prefix):]) for c in codes if c[len(prefix):].isdigit()), default=0)
            code = f"{prefix}{seq + 1:04d}"
            while db.scalar(select(BaseSupplier.id).where(BaseSupplier.code == code)):
                seq += 1
                code = f"{prefix}{seq + 1:04d}"
            sup = BaseSupplier(code=code, name=supplier_name, remark="送货单 OCR 自动创建")
            sup._created = True  # 临时标记（非表字段），用于响应提示
            db.add(sup)
            db.flush()
        supplier_id = sup.id
        supplier_created = bool(getattr(sup, "_created", False))

    # 物料自动匹配/新增：确认转入入库时，系统不存在的物料自动创建
    confirmed_items: list[dict] = []
    for it in req.items:
        name = (it.product_name or "").strip()
        if not name:
            confirmed_items.append(it.model_dump() | {"product_id": 0})
            continue
        p = _match_or_create_product(db, it, name)
        confirmed_items.append(it.model_dump() | {
            "product_id": p.id if p else 0,
            "product_name": name,
            "_created": bool(getattr(p, "_created", False)),
        })

    if req.record_id:
        rec = db.get(OcrRecord, req.record_id)
        if rec is None:
            raise BizError(E_NOT_FOUND, "识别记录不存在")
        rec.structured = {
            "supplier_name": supplier_name,
            "bill_no": req.bill_no.strip(),
            "items": confirmed_items,
        }
        rec.match_status = 3  # 人工确认
    db.commit()
    # 确认可能新建 供应商/单位/分类 → 失效对应字典缓存（与事务同函数、commit 后调用）
    from app.core.cache import cache_delete_pattern

    if supplier_created:
        cache_delete_pattern("dict:suppliers*")
    if any(i.get("_created") for i in confirmed_items):
        cache_delete_pattern("dict:suppliers*", "dict:units", "dict:categories")
    return ok({
        "supplier_id": supplier_id,
        "supplier_name": supplier_name,
        "supplier_created": supplier_created,
        "supplier_matched_name": supplier_matched_name,  # AI 别名归一命中的已有供应商名（空=未命中）
        "bill_no": req.bill_no.strip(),
        "record_id": req.record_id,
        "items": confirmed_items,
        "created_products": [i for i in confirmed_items if i.get("_created")],
    })


def _match_or_create_product(db: Session, it, name: str) -> BaseProduct | None:
    """按 物料编码 → 名称 精确匹配系统材料；不存在则用识别数据自动新增（单位自动匹配/创建）。"""
    if is_footer_text(name):
        return None  # 表头/合计等非明细行：跳过自动建料（容错，防脏数据落库）
    if it.material_code:
        p = db.scalar(select(BaseProduct).where(BaseProduct.material_code == it.material_code.strip()))
        if p:
            return p
    p = db.scalar(select(BaseProduct).where(BaseProduct.name == name))
    if p:
        return p
    try:
        unit_id = 0
        unit_name = (it.unit or "").strip()
        if unit_name and not re.match(r"^.{1,6}[0-9a-f]{6}$", unit_name):
            u = db.scalar(select(BaseUnit).where(BaseUnit.name == unit_name))
            if u is None:
                u = BaseUnit(name=unit_name, remark="送货单 OCR 自动创建")
                db.add(u)
                db.flush()
            unit_id = u.id
        if not unit_id:
            unit_id = db.scalar(select(BaseUnit.id).order_by(BaseUnit.id).limit(1)) or 0
        if not unit_id:
            return None  # 无单位库无法建材料（前端可稍后在入库页选择）
        code = str((db.execute(text("SELECT MAX(CAST(code AS UNSIGNED)) FROM base_product WHERE code REGEXP '^[0-9]+$'")).scalar() or 0) + 1)
        # DeepSeek 材料分类：匹配/自动创建分类后关联（自动分类入库）
        category_id = 0
        cat_name = (getattr(it, "category_name", "") or "").strip()
        if cat_name and cat_name != "未分类":
            cat = db.scalar(select(BaseCategory).where(BaseCategory.name == cat_name))
            if cat is None:
                cat = BaseCategory(name=cat_name, parent_id=0, sort=0, path="/")
                db.add(cat)
                db.flush()
            category_id = cat.id
        p = BaseProduct(
            code=code, material_code=it.material_code.strip(), name=name, spec=it.spec.strip(),
            unit_id=unit_id, category_id=category_id, purchase_price=_parse_price(it.price),
            remark="送货单 OCR 自动创建",
        )
        db.add(p)
        db.flush()
        p._created = True  # type: ignore[attr-defined]  # 标记本次新建（响应 created_products）
        return p
    except Exception:
        return None


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
    """未匹配文本 → 商品识别兜底：本地 OCR 模板 → 视觉模型（豆包/SiliconFlow）分析 → 生成 ai_suggestion。

    豆包关闭不影响：模板命中走模板（秒级），否则用 SiliconFlow 视觉模型；两者均不可用才报错。
    """
    record = db.get(OcrRecord, record_id)
    if record is None:
        raise BizError(E_NOT_FOUND, "识别记录不存在")
    # 1) 本地 OCR 模板优先：识别记录文本命中模板 → 直接用模板结构化字段（不调大模型）
    record_texts = [str(r.get("text") or "") for r in (record.raw_result or []) if isinstance(r, dict)]
    record_texts = correct_texts(db, record_texts)  # 纠错后再匹配模板（失败原样）
    tpl = match_template(db, record_texts)
    if tpl:
        name = (tpl.get("product_name") or tpl.get("name") or "未知商品")[:100]
        suggestion = AiSuggestion(
            ocr_record_id=record.id, product_name=name, model="ocr-template",
            suggestion={
                "spec": str(tpl.get("spec") or "")[:100],
                "category": "",
                "note": "本地 OCR 模板匹配（视觉大模型训练生成）",
            },
            status=1,  # 待处理
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)
        return ok({"suggestion_id": suggestion.id, "product_name": name, "detail": suggestion.suggestion})
    # 2) 视觉模型分析链：豆包 → SiliconFlow（豆包关闭/未配置时用 SiliconFlow 视觉模型）
    file_bytes = _read_file_bytes(db, record.file_id, user)
    llm = None
    for llm_name in ("doubao", "siliconflow"):
        try:
            llm = get_llm(db, llm_name)
            break
        except LLMNotConfigured:
            continue
    if llm is None:
        raise BizError(5002, "大模型分析不可用：豆包与视觉模型均未配置或未启用（系统设置 → OCR 与大模型）")
    prompt = (
        "识别图片中的商品/物料，输出JSON：{\"name\": 商品名称, \"spec\": 规格型号, "
        "\"category\": 类别, \"note\": 其他可识别信息}。无法识别时 name 给最可能的名称。只输出JSON。"
    )
    try:
        content = llm.chat_image(file_bytes, prompt, scene="match_vision")
    except Exception as e:
        raise BizError(5002, f"{llm.name} 视觉识别失败：{e}")
    try:
        start, end = content.find("{"), content.rfind("}")
        parsed = json.loads(content[start : end + 1]) if start >= 0 and end >= 0 else {}
    except Exception:
        parsed = {}
    name = str(parsed.get("name") or "未知商品")[:100]
    suggestion = AiSuggestion(
        ocr_record_id=record.id, product_name=name, model=llm.name,
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


@router.get("/ai-suggestions", dependencies=[Depends(require_permission("ai:suggestion"))])
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
    if code and not code.isdigit():
        raise BizError(E_PARAM, "商品编码必须是纯数字（留空自动生成）")
    if not code:  # 自动生成：当前最大数字编码 + 1
        code = str((db.execute(text("SELECT MAX(CAST(code AS UNSIGNED)) FROM base_product WHERE code REGEXP '^[0-9]+$'")).scalar() or 0) + 1)
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


@router.post("/ai-suggestions/{sug_id}/ignore", dependencies=[Depends(require_permission("ai:suggestion"))])
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
