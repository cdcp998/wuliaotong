"""大模型客户端抽象（《后端API设计.md》§11.3、数据库设计决策 4）。

- DoubaoClient：视觉模型（看图识别商品），火山方舟 OpenAI 兼容接口
- DeepSeekClient：文本模型（OCR 文本结构化/纠错/归一化，不支持图像输入）
- API Key/BaseURL/Model 存 sys_config（llm.doubao.* / llm.deepseek.*），接口返回时脱敏
- 未配置时调用抛 LLMNotConfigured，由调用方降级（人工录入），不影响主流程
"""
from __future__ import annotations

import base64
from typing import Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.response import BizError, E_LLM_FAILED
from app.models.sys import SysConfig

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
        try:
            resp = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "messages": messages, "temperature": 0.1},
                timeout=LLM_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()
        except Exception as e:  # 网络/鉴权/限流等
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


def get_llm(db: Session, name: str = "") -> LLMClient:
    """按 sys_config 创建大模型客户端；未配置抛 LLMNotConfigured。"""
    name = name or "doubao"
    if name == "doubao":
        key = _get_config(db, "llm.doubao.api_key")
        if not key:
            raise LLMNotConfigured("豆包大模型未配置（系统设置 → 大模型）")
        return DoubaoClient(
            api_key=key,
            base_url=_get_config(db, "llm.doubao.base_url") or "https://ark.cn-beijing.volces.com/api/v3",
            model=_get_config(db, "llm.doubao.model") or "doubao-1-5-vision-pro-32k-250115",
        )
    if name == "deepseek":
        key = _get_config(db, "llm.deepseek.api_key")
        if not key:
            raise LLMNotConfigured("DeepSeek 大模型未配置（系统设置 → 大模型）")
        return DeepSeekClient(
            api_key=key,
            base_url=_get_config(db, "llm.deepseek.base_url") or "https://api.deepseek.com",
            model=_get_config(db, "llm.deepseek.model") or "deepseek-chat",
        )
    raise ValueError(f"未知大模型: {name}")
