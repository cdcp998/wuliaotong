"""OCR 文本纠错归一化测试（P9-①，L2 门禁）：修正生效/行数不一致回退/未配置降级。"""
from app.db import SessionLocal
from app.services.ocr import correction
from app.services.llm import LLMNotConfigured


class _FakeLLM:
    name = "deepseek"

    def __init__(self, content: str) -> None:
        self.content = content

    def chat_text(self, system: str, user: str) -> str:
        return self.content


def test_correct_returns_fixed_lines(monkeypatch):
    """DeepSeek 修正生效：错字/多余空格归一，行数保持一致。"""
    monkeypatch.setattr(correction, "get_llm", lambda db, name: _FakeLLM("轴承6204\n数量10\n"))
    with SessionLocal() as db:
        out = correction.correct_texts(db, ["轴承 6204", "数量 10"])
    assert out == ["轴承6204", "数量10"]


def test_correct_line_count_mismatch_falls_back(monkeypatch):
    """模型增删行（行数不一致）→ 回退原样，保证行与原文对齐。"""
    monkeypatch.setattr(correction, "get_llm", lambda db, name: _FakeLLM("只输出一行\n多了一行\n"))
    with SessionLocal() as db:
        lines = ["a", "b"]
        assert correction.correct_texts(db, lines) == lines


def test_correct_not_configured_falls_back(monkeypatch):
    """文本模型未配置 → 原样返回（降级不阻断）。"""
    monkeypatch.setattr(correction, "get_llm", lambda db, name: (_ for _ in ()).throw(LLMNotConfigured("未配置")))
    with SessionLocal() as db:
        lines = ["轴承6204", "数量 10"]
        assert correction.correct_texts(db, lines) == lines


def test_correct_short_blob_skipped():
    """内容过短/为空不调用模型，直接原样（防无意义消耗）。"""
    with SessionLocal() as db:
        assert correction.correct_texts(db, []) == []
        assert correction.correct_texts(db, ["a"]) == ["a"]
