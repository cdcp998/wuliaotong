"""送货单版式匹配模板（JSON 存储）。

- 存储：sys_config key=ocr.delivery_templates（JSON 数组），与商品模板 product_templates 同模式。
- 模板字段：{id, name, anchors: [表头关键词], created_at}
- 匹配：本地 OCR 文本（去空白）包含模板全部 anchors → 命中（说明是已知版式）。
- 学习：遇到新表单且大模型/本地解析成功时，自动从 OCR 文本提取表头关键词生成模板入库，
  下次同一版式即可直接命中。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sys import SysConfig

TEMPLATE_KEY = "ocr.delivery_templates"

# 用于识别版式的表头关键词（兼容采购订单 / 新格式送货单）
_HEADER_KEYWORDS = (
    "货物名称", "品名", "物料名称", "商品名称", "产品名称", "名称",
    "厂家品牌", "厂家", "品牌", "厂商", "生产厂家",
    "规格型号", "规格", "型号", "数量", "单价", "金额", "数量单价", "数量金额",
    "含税单价", "价税合计", "单位", "备注", "申报单位", "物料编码", "行号", "序号",
    "送货单号", "单据编号", "订单编号", "采购订单", "供应商", "供货单位",
)


def load_templates(db: Session) -> list[dict]:
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == TEMPLATE_KEY))
    if not cfg or not cfg.config_value:
        return []
    try:
        data = json.loads(cfg.config_value)
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001 数据损坏按空处理，可重新学习
        return []


def save_templates(db: Session, templates: list[dict]) -> None:
    raw = json.dumps(templates, ensure_ascii=False)
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == TEMPLATE_KEY))
    if cfg is None:
        db.add(SysConfig(config_key=TEMPLATE_KEY, config_value=raw, remark="送货单版式匹配模板（JSON）"))
    else:
        cfg.config_value = raw
    db.commit()


def _blob(texts: list[str]) -> str:
    return "".join(texts).replace(" ", "").replace("\u3000", "").replace("\t", "")


def match_template(db: Session, texts: list[str]) -> dict | None:
    """命中已知版式模板：OCR 文本包含模板全部 anchors。"""
    if not texts:
        return None
    blob = _blob(texts)
    if not blob:
        return None
    for tpl in load_templates(db):
        anchors = tpl.get("anchors") or []
        if anchors and all(a in blob for a in anchors):
            return tpl
    return None


def learn_template(db: Session, texts: list[str], structured: dict | None) -> dict | None:
    """从成功解析的新表单学习版式模板；锚点不足或已存在则跳过。"""
    if not texts or not structured or not structured.get("items"):
        return None
    blob = _blob(texts)
    anchors: list[str] = []
    for kw in _HEADER_KEYWORDS:
        if kw in blob and kw not in anchors:
            anchors.append(kw)
    if len(anchors) < 3:
        return None

    templates = load_templates(db)
    for tpl in templates:
        if sorted(tpl.get("anchors") or []) == sorted(anchors):
            return tpl

    tpl = {
        "id": f"dlv_{uuid.uuid4().hex[:8]}",
        "name": f"表单-{anchors[0]}-{anchors[1]}",
        "anchors": anchors,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    save_templates(db, [*templates, tpl])
    return tpl
