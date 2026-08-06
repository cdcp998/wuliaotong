"""本地 OCR 商品识别模板：由视觉大模型识别样本图「训练」生成，之后本地 OCR 文本秒级匹配，
无需每次调用大模型（离线、免费、快）。

模板条目结构：{id, name, brand, product_name, spec, anchors: [关键词], created_at}
- anchors 自动提取自视觉识别结果（品牌/规格/商品名，去空白）
- 匹配规则：本地 OCR 全部文本（去空白拼接）包含模板的全部锚点 → 命中
- 存储：sys_config key=ocr.product_templates（JSON 数组；设置页 SETTINGS_KEYS 不暴露，走专用接口管理）
"""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sys import SysConfig

TEMPLATE_KEY = "ocr.product_templates"


def load_templates(db: Session) -> list[dict]:
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == TEMPLATE_KEY))
    if not cfg or not cfg.config_value:
        return []
    try:
        data = json.loads(cfg.config_value)
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001 模板数据损坏时按空处理，可重新训练
        return []


def save_templates(db: Session, templates: list[dict]) -> None:
    raw = json.dumps(templates, ensure_ascii=False)
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == TEMPLATE_KEY))
    if cfg is None:
        db.add(SysConfig(config_key=TEMPLATE_KEY, config_value=raw, remark="本地 OCR 商品识别模板（视觉大模型训练生成）"))
    else:
        cfg.config_value = raw
    db.commit()


def build_anchors(prod: dict) -> list[str]:
    """从视觉结构化识别结果提取锚点（品牌/规格/商品名，长度≥2 且去重）。"""
    anchors: list[str] = []
    for field in ("brand", "spec", "product_name"):
        v = (prod.get(field) or "").strip()
        if len(v) >= 2 and v not in anchors:
            anchors.append(v)
    return anchors


def match_template(db: Session, texts: list[str]) -> dict | None:
    """本地 OCR 文本匹配模板：全部锚点命中（忽略空白差异）返回模板，否则 None。"""
    if not texts:
        return None
    blob = "".join(texts).replace(" ", "").replace("\u3000", "").replace("\t", "")
    if not blob:
        return None
    for tpl in load_templates(db):
        anchors = tpl.get("anchors") or []
        if anchors and all(a.replace(" ", "") in blob for a in anchors):
            return tpl
    return None
