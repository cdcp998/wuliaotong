"""大模型客户端抽象（《后端API设计.md》§11.3、数据库设计决策 4）。

- DoubaoClient：视觉模型（看图识别商品），火山方舟 OpenAI 兼容接口
- DeepSeekClient：文本模型（OCR 文本结构化/纠错/归一化，不支持图像输入）
- API Key/BaseURL/Model 存 sys_config（llm.doubao.* / llm.deepseek.*），接口返回时脱敏
- 未配置时调用抛 LLMNotConfigured，由调用方降级（人工录入），不影响主流程
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


class _OpenAICompatClient:
    """OpenAI 兼容 Chat Completions 客户端（豆包/DeepSeek 均支持）。"""

    name = "base"

    def __init__(self, base_url: str, api_key: str, model: str, vision: bool = False) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.vision = vision

    def _request(self, messages: list[dict]) -> str:
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
            logger.debug("大模型调用成功 name=%s model=%s 耗时=%.1fs 输入=%d 输出=%d", self.name, self.model, time.time() - start, len(messages), len(content))
            return content
        except Exception as e:  # 网络/鉴权/限流等
            logger.error("大模型调用失败 name=%s model=%s 耗时=%.1fs: %s", self.name, self.model, time.time() - start, e)
            raise BizError(E_LLM_FAILED, f"大模型调用失败：{e}")

    def chat_text(self, system: str, user: str) -> str:
        return self._request([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ])

    def chat_image(self, image_bytes: bytes, prompt: str) -> str:
        if not self.vision:
            raise BizError(E_LLM_FAILED, "当前模型不支持图像输入（请配置豆包视觉模型）")
        b64 = base64.b64encode(image_bytes).decode()
        return self._request([
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }
        ])


class DoubaoClient(_OpenAICompatClient):
    name = "doubao"

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        super().__init__(base_url, api_key, model, vision=True)


class DeepSeekClient(_OpenAICompatClient):
    name = "deepseek"

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        super().__init__(base_url, api_key, model, vision=False)


class SiliconFlowClient(_OpenAICompatClient):
    """SiliconFlow（硅基流动）视觉/文本模型，OpenAI 兼容接口（https://api.siliconflow.cn/v1）。"""

    name = "siliconflow"

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        super().__init__(base_url, api_key, model, vision=True)


def get_llm(db: Session, name: str = "") -> LLMClient:
    """按 sys_config 创建大模型客户端；未配置或开关关闭抛 LLMNotConfigured。"""
    name = name or "doubao"
    if name == "doubao":
        if _get_config(db, "llm.doubao.enabled") == "0":
            raise LLMNotConfigured("豆包大模型已关闭（系统设置 → OCR 与大模型 → 启用开关）")
        key = _get_config(db, "llm.doubao.api_key")
        if not key:
            raise LLMNotConfigured("豆包大模型未配置（系统设置 → 大模型）")
        return DoubaoClient(
            api_key=key,
            base_url=_get_config(db, "llm.doubao.base_url") or "https://ark.cn-beijing.volces.com/api/v3",
            model=_get_config(db, "llm.doubao.model") or "doubao-1-5-vision-pro-32k-250115",
        )
    if name == "siliconflow":
        if _get_config(db, "llm.siliconflow.enabled") == "0":
            raise LLMNotConfigured("SiliconFlow 视觉大模型已关闭（系统设置 → OCR 与大模型 → 启用开关）")
        key = _get_config(db, "llm.siliconflow.api_key")
        if not key:
            raise LLMNotConfigured("SiliconFlow 视觉大模型未配置（系统设置 → OCR 与大模型）")
        return SiliconFlowClient(
            api_key=key,
            base_url=_get_config(db, "llm.siliconflow.base_url") or "https://api.siliconflow.cn/v1",
            # 默认视觉模型：nex-agi/Nex-N2-Pro（2026-08-07 SiliconFlow 在售；旧默认 Qwen/Qwen2.5-VL-7B-Instruct 已下线导致 400）
            model=_get_config(db, "llm.siliconflow.model") or "nex-agi/Nex-N2-Pro",
        )
    if name == "deepseek":
        if _get_config(db, "llm.deepseek.enabled") == "0":
            raise LLMNotConfigured("DeepSeek 大模型已关闭（系统设置 → OCR 与大模型 → 启用开关）")
        key = _get_config(db, "llm.deepseek.api_key")
        if not key:
            raise LLMNotConfigured("DeepSeek 大模型未配置（系统设置 → 大模型）")
        return DeepSeekClient(
            api_key=key,
            base_url=_get_config(db, "llm.deepseek.base_url") or "https://api.deepseek.com",
            model=_get_config(db, "llm.deepseek.model") or "deepseek-chat",
        )
    raise ValueError(f"未知大模型: {name}")
