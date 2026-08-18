"""OCR 识别文本纠错与归一化（DeepSeek 文本模型）：修正错别字/全半角/多余空格/单位写法，
不改变语义、不增删行。未启用/未配置/调用失败一律原样返回（降级不影响主流程）。

开关：sys_config ai.correct_enabled（默认 1，设置 0 关闭走原样）。
接入点：/ocr/quick 本地 OCR 文本、/ocr/match 模板匹配前（视觉路径不接入，避免同步接口过慢）。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.response import BizError
from app.models.sys import SysConfig
from app.services.llm import LLMNotConfigured, chat_text_with_fallback

CORRECT_PROMPT = (
    "你是OCR文字纠错助手。以下是从图片识别出的文本行，可能包含错别字、乱码、全半角混杂、多余空格、"
    "单位写法不规范（如 件/PC、千克/kg、毫米/mm）。请逐行修正为规范中文："
    "保持原语义、不增删行、不合并拆分、每行输出一条，只输出修正后的行，用换行分隔，不要解释。\n文本行：\n"
)


def _chat_text_with_fallback(db: Session, system: str, user: str, scene: str = "") -> str:
    """多模态大模型（豆包）文本主用 → 文本模型（DeepSeek）备用（任务开关关闭时直接走备用）。"""
    return chat_text_with_fallback(db, system, user, scene=scene)


def correct_texts(db: Session, lines: list[str]) -> list[str]:
    """DeepSeek 纠错归一；开关关闭/未配置/调用失败/行数不一致时返回原样。"""
    if not lines:
        return lines
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ai.correct_enabled"))
    if cfg and cfg.config_value == "0":
        return lines
    blob = "".join(lines)
    # 保护：内容过短/过长（识别空或乱码）不纠错，避免无意义消耗
    if len(blob) < 4 or len(blob) > 4000:
        return lines
    try:
        content = _chat_text_with_fallback(db, "只输出修正后的文本行，不要解释", CORRECT_PROMPT + "\n".join(lines), scene="ocr_correct")
    except (LLMNotConfigured, BizError):
        return lines
    out = [ln.strip() for ln in content.splitlines() if ln.strip()]
    # 模型增删行会导致行与原文错位 → 丢弃修正结果，回退原样（保证行对齐）
    return out if len(out) == len(lines) else lines
