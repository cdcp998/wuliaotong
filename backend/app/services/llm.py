"""大模型客户端抽象（《后端API设计.md》§11.3、数据库设计决策 4）。

- MMLLMClient：多模态大模型（看图识别商品/送货单 + 文本，任意 OpenAI 兼容服务商）
- DeepSeekClient：文本模型（OCR 文本结构化/纠错/归一化，不支持图像输入）
- SiliconFlowClient：视觉模型（视觉识别）
- API Key/BaseURL/Model 存 sys_config（llm.mm_llm.* / llm.deepseek.* / llm.siliconflow.*），接口返回时脱敏
- 未配置时调用抛 LLMNotConfigured，由调用方降级（人工录入），不影响主流程

兼容性标准：三个模型槽位（多模态 / 文本 / 视觉）均遵循 **OpenAI Chat Completions
兼容协议**（POST {base_url}/chat/completions，Authorization: Bearer，messages 格式），
Base URL / API Key / 模型名可自由指向任意兼容服务商（通义、智谱、火山方舟、自建
vLLM / Ollama、第三方网关等），不绑定特定供应商。
"""
from __future__ import annotations

import base64
import logging
import time
from typing import Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.response import BizError, E_LLM_FAILED
from app.models.sys import SysConfig

logger = logging.getLogger("app.llm")

LLM_TIMEOUT = 60


class LLMNotConfigured(RuntimeError):
    """大模型未配置（对应错误码 5002 的降级场景）。"""


class LLMClient(Protocol):
    name: str

    def chat_text(self, system: str, user: str) -> str:
        """纯文本对话。"""
        ...

    def chat_image(self, image_bytes: bytes, prompt: str) -> str:
        """图片 + 文本（视觉模型）。"""
        ...


def _get_config(db: Session, key: str) -> str:
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    return cfg.config_value if cfg else ""


def _log_llm_call(scene: str, model: str, prompt_text: str, output: str, status: str, error: str, duration_ms: int, user_id: int | None = None) -> None:
    """大模型调用日志（P9）：fire-and-forget 写 sys_llm_log，失败不影响主流程。"""
    try:
        from app.db import SessionLocal
        from app.models.sys import LlmLog

        s = SessionLocal()
        try:
            s.add(LlmLog(
                scene=scene[:50], model=model[:50],
                # TEXT 列上限 65535 字节，按 utf8mb4 最坏 4 字节/字符留余量，尽量保存完整内容供详情查看
                prompt=prompt_text[:15000], output=output[:15000],
                status=status[:10], error=error[:5000],
                duration_ms=int(duration_ms), user_id=user_id,
            ))
            s.commit()
        finally:
            s.close()
    except Exception:  # noqa: BLE001 日志失败绝不能影响业务
        pass


class _OpenAICompatClient:
    """OpenAI 兼容 Chat Completions 客户端（多模态/文本/视觉模型均支持）。"""

    name = "base"

    def __init__(self, base_url: str, api_key: str, model: str, vision: bool = False) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.vision = vision

    def _request(self, messages: list[dict], scene: str = "", user_id: int | None = None) -> str:
        # 输入记录：图片 base64 省略（只记张数），文本拼接截断
        parts: list[str] = []
        img_count = 0
        for m in messages:
            c = m.get("content")
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, list):
                for item in c:
                    if item.get("type") == "text":
                        parts.append(str(item.get("text") or ""))
                    elif item.get("type") == "image_url":
                        img_count += 1
        prompt_text = "\n".join(parts)
        if img_count:
            prompt_text = f"[图片×{img_count}]\n" + prompt_text
        start = time.time()
        try:
            resp = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "messages": messages, "temperature": 0.1},
                timeout=LLM_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"].strip()
            _log_llm_call(scene, self.name, prompt_text, content, "ok", "", (time.time() - start) * 1000, user_id)
            logger.debug("大模型调用成功 name=%s model=%s 耗时=%.1fs 输入=%d 输出=%d", self.name, self.model, time.time() - start, len(messages), len(content))
            return content
        except Exception as e:  # 网络/鉴权/限流等
            _log_llm_call(scene, self.name, prompt_text, "", "error", str(e), (time.time() - start) * 1000, user_id)
            logger.error("大模型调用失败 name=%s model=%s 耗时=%.1fs: %s", self.name, self.model, time.time() - start, e)
            # 完整错误只进日志/调用记录，客户端仅返回可读摘要（避免暴露服务商接口细节）
            raise BizError(E_LLM_FAILED, "大模型调用失败，请稍后重试（详情见系统日志/AI 调用日志）") from e

    def chat_text(self, system: str, user: str, scene: str = "", user_id: int | None = None) -> str:
        return self._request([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ], scene=scene, user_id=user_id)

    def chat_image(self, image_bytes: bytes, prompt: str, scene: str = "", user_id: int | None = None) -> str:
        if not self.vision:
            raise BizError(E_LLM_FAILED, "当前模型不支持图像输入（请配置多模态大模型）")
        b64 = base64.b64encode(image_bytes).decode()
        return self._request([
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }
        ], scene=scene, user_id=user_id)


class MMLLMClient(_OpenAICompatClient):
    """多模态大模型（视觉 + 文本），OpenAI 兼容接口。"""

    name = "mm_llm"

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        super().__init__(base_url, api_key, model, vision=True)


class DeepSeekClient(_OpenAICompatClient):
    name = "deepseek"

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        super().__init__(base_url, api_key, model, vision=False)


class SiliconFlowClient(_OpenAICompatClient):
    """视觉模型，OpenAI 兼容接口。"""

    name = "siliconflow"

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        super().__init__(base_url, api_key, model, vision=True)


# 模型承担的业务任务开关：sys_config llm.{model}.scene.{scene}.enabled（1 启用 / 0 关闭该任务跳过此模型）
# 场景与 quota.SCENE_META 的 scene 一致；未配置视为启用


def model_scene_enabled(db: Session, model: str, scene: str) -> bool:
    """任务开关：指定模型是否承担该任务（默认开启；关闭后该模型不参与此任务，直接走其他模型/降级）。"""
    if not scene:
        return True
    return _get_config(db, f"llm.{model}.scene.{scene}.enabled") != "0"


def chat_image_with_fallback(db: Session, image_bytes: bytes, prompt: str, scene: str = "") -> str:
    """多模态大模型主用 → 视觉模型备用；各模型任务开关关闭时跳过对应模型。"""
    last_err: Exception | None = None
    for name in ("mm_llm", "siliconflow"):
        if not model_scene_enabled(db, name, scene):
            last_err = LLMNotConfigured(f"{name} 未承担该任务（任务开关已关闭）")
            continue
        try:
            llm = get_llm(db, name)
            return llm.chat_image(image_bytes, prompt, scene=scene)
        except (LLMNotConfigured, BizError) as e:
            last_err = e
            continue
    if isinstance(last_err, BizError):
        raise last_err
    raise LLMNotConfigured("多模态/视觉大模型均未配置或调用失败")


def chat_text_with_fallback(db: Session, system: str, user: str, scene: str = "") -> str:
    """多模态大模型文本主用 → 文本模型备用；各模型任务开关关闭时跳过对应模型。"""
    last_err: Exception | None = None
    for name in ("mm_llm", "deepseek"):
        if not model_scene_enabled(db, name, scene):
            last_err = LLMNotConfigured(f"{name} 未承担该任务（任务开关已关闭）")
            continue
        try:
            llm = get_llm(db, name)
            return llm.chat_text(system, user, scene=scene)
        except (LLMNotConfigured, BizError) as e:
            last_err = e
            continue
    if isinstance(last_err, BizError):
        raise last_err
    raise LLMNotConfigured("多模态/文本大模型均未配置或调用失败")


def get_llm(db: Session, name: str = "") -> LLMClient:
    """按 sys_config 创建大模型客户端；未配置或开关关闭抛 LLMNotConfigured。"""
    name = name or "mm_llm"
    if name == "mm_llm":
        if _get_config(db, "llm.mm_llm.enabled") == "0":
            raise LLMNotConfigured("多模态大模型已关闭（系统设置 → OCR 与大模型 → 启用开关）")
        key = _get_config(db, "llm.mm_llm.api_key")
        base_url = _get_config(db, "llm.mm_llm.base_url")
        model = _get_config(db, "llm.mm_llm.model")
        if not key:
            raise LLMNotConfigured("多模态大模型未配置 API Key（系统设置 → 大模型）")
        if not base_url or not model:
            raise LLMNotConfigured("多模态大模型未配置 Base URL / 模型名（系统设置 → 大模型）")
        return MMLLMClient(api_key=key, base_url=base_url, model=model)
    if name == "siliconflow":
        if _get_config(db, "llm.siliconflow.enabled") == "0":
            raise LLMNotConfigured("视觉大模型已关闭（系统设置 → OCR 与大模型 → 启用开关）")
        key = _get_config(db, "llm.siliconflow.api_key")
        if not key:
            raise LLMNotConfigured("视觉大模型未配置（系统设置 → OCR 与大模型）")
        return SiliconFlowClient(
            api_key=key,
            base_url=_get_config(db, "llm.siliconflow.base_url") or "https://api.siliconflow.cn/v1",
            # 默认视觉模型：nex-agi/Nex-N2-Pro
            model=_get_config(db, "llm.siliconflow.model") or "nex-agi/Nex-N2-Pro",
        )
    if name == "deepseek":
        if _get_config(db, "llm.deepseek.enabled") == "0":
            raise LLMNotConfigured("文本大模型已关闭（系统设置 → OCR 与大模型 → 启用开关）")
        key = _get_config(db, "llm.deepseek.api_key")
        if not key:
            raise LLMNotConfigured("文本大模型未配置（系统设置 → 大模型）")
        return DeepSeekClient(
            api_key=key,
            base_url=_get_config(db, "llm.deepseek.base_url") or "https://api.deepseek.com",
            model=_get_config(db, "llm.deepseek.model") or "deepseek-chat",
        )
    raise ValueError(f"未知大模型: {name}")
