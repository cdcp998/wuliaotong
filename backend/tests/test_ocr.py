"""OCR/大模型接口测试（P5，L2 门禁）。mock 识别引擎与大模型客户端，不依赖真实引擎/API Key。

覆盖：拍照快查匹配、异步识别任务状态机（成功/失败）、AI 建议生成→确认新增→重复处理拒绝、
忽略、权限（无 ocr:use → 403）。
"""
import io
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _upload_img() -> int:
    buf = io.BytesIO()
    Image.new("RGB", (200, 80), color=(240, 240, 240)).save(buf, format="PNG")
    r = client.post("/api/v1/files/upload?biz_type=ocr", files={"file": ("o.png", buf.getvalue(), "image/png")})
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["file_id"]


class _FakeEngine:
    """伪造 RapidOCR 引擎：返回指定文本行。"""

    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    def recognize(self, image_bytes: bytes):
        from app.services.ocr.client import OcrLine

        return [OcrLine(t, 0.99, []) for t in self._lines]


class _FakeDoubao:
    """伪造豆包视觉客户端。"""

    name = "doubao"

    def __init__(self, content: str) -> None:
        self._content = content

    def chat_image(self, image_bytes: bytes, prompt: str) -> str:
        return self._content

    def chat_text(self, system: str, user: str) -> str:
        return self._content


def _setup_product(name: str) -> int:
    client.post("/api/v1/units", json={"name": "OCR件" + uuid.uuid4().hex[:6]})
    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "9" + str(uuid.uuid4().int % 10**9), "name": name, "unit_id": unit_id})
    return r.json()["data"]["id"]


def test_ocr_quick_match(monkeypatch):
    _login_admin()
    name = "轴承" + uuid.uuid4().hex[:6]  # 唯一名称，避免 LIMIT 5 截断命中历史商品
    pid = _setup_product(name)
    file_id = _upload_img()
    monkeypatch.setattr("app.api.ocr.get_ocr_engine", lambda db: _FakeEngine([name, "数量 10"]))

    r = client.post(f"/api/v1/ocr/quick?file_id={file_id}&ocr_type=2")
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["lines"] == [name, "数量 10"]
    assert any(m["product_id"] == pid for m in data["matches"])


def test_ocr_recognize_task(monkeypatch):
    _login_admin()
    file_id = _upload_img()
    monkeypatch.setattr("app.api.ocr.get_ocr_engine", lambda db: _FakeEngine(["送货单", "轴承 10 8.50"]))

    r = client.post(f"/api/v1/ocr/recognize?file_id={file_id}&ocr_type=1")
    assert r.json()["code"] == 0, r.text
    task_id = r.json()["data"]["task_id"]

    # 轮询直到完成
    for _ in range(20):
        r = client.get(f"/api/v1/ocr/tasks/{task_id}")
        if r.json()["data"]["status"] == "done":
            break
        time.sleep(0.1)
    assert r.json()["data"]["status"] == "done"
    assert "lines" in r.json()["data"]["structured"]
    # 识别记录落库
    recs = client.get("/api/v1/ocr/records").json()["data"]
    assert recs["total"] >= 1

    # 任务不存在 → 4003
    assert client.get("/api/v1/ocr/tasks/nope").json()["code"] == 4003


def test_ocr_recognize_failed(monkeypatch):
    _login_admin()
    file_id = _upload_img()

    class _Broken:
        def recognize(self, image_bytes: bytes):
            raise RuntimeError("engine down")

    monkeypatch.setattr("app.api.ocr.get_ocr_engine", lambda db: _Broken())
    r = client.post(f"/api/v1/ocr/recognize?file_id={file_id}&ocr_type=1")
    task_id = r.json()["data"]["task_id"]
    for _ in range(20):
        r = client.get(f"/api/v1/ocr/tasks/{task_id}")
        body = r.json()
        if body.get("code") == 5001 or (body["data"] and body["data"]["status"] == "failed"):
            break
        time.sleep(0.1)
    assert r.json()["code"] == 5001


def test_ai_suggestion_flow(monkeypatch):
    _login_admin()
    file_id = _upload_img()
    monkeypatch.setattr("app.api.ocr.get_ocr_engine", lambda db: _FakeEngine(["某新物料"]))
    # 未匹配（不建商品）→ 记录 match_status=2
    r = client.post(f"/api/v1/ocr/quick?file_id={file_id}&ocr_type=2")
    assert r.json()["data"]["matches"] == []

    # 从识别记录触发 AI 匹配（mock 豆包返回 JSON）
    recs = client.get("/api/v1/ocr/records?match_status=2").json()["data"]["list"]
    record_id = recs[0]["id"]
    monkeypatch.setattr(
        "app.api.ocr.get_llm",
        lambda db, name: _FakeDoubao('{"name": "新型密封圈", "spec": "30x15", "category": "密封件", "note": ""}'),
    )
    r = client.post(f"/api/v1/ocr/match?record_id={record_id}")
    assert r.json()["code"] == 0, r.text
    sug_id = r.json()["data"]["suggestion_id"]
    assert r.json()["data"]["product_name"] == "新型密封圈"

    # 确认新增商品
    r = client.post(f"/api/v1/ai-suggestions/{sug_id}/accept?name=新型密封圈&purchase_price=3.50")
    assert r.json()["code"] == 0, r.text
    pid = r.json()["data"]["product_id"]
    assert client.get(f"/api/v1/products/{pid}").json()["data"]["name"] == "新型密封圈"
    assert client.get(f"/api/v1/products/{pid}").json()["data"]["purchase_price"] == "3.50"

    # 重复处理 → 4002
    assert client.post(f"/api/v1/ai-suggestions/{sug_id}/accept").json()["code"] == 4002

    # 忽略
    r = client.post(f"/api/v1/ocr/match?record_id={record_id}")
    sug2 = r.json()["data"]["suggestion_id"]
    assert client.post(f"/api/v1/ai-suggestions/{sug2}/ignore").json()["code"] == 0
    assert client.post(f"/api/v1/ai-suggestions/{sug2}/ignore").json()["code"] == 4002

    # 待处理列表
    lst = client.get("/api/v1/ai-suggestions?status=1").json()["data"]
    assert isinstance(lst["list"], list)


def test_ocr_permission():
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.json()["code"] == 0
    # 使用者无 ocr:use → 403
    assert c.post("/api/v1/ocr/quick?file_id=1&ocr_type=2").status_code == 403
    assert c.post("/api/v1/ocr/recognize?file_id=1&ocr_type=1").status_code == 403
    # 未登录 → 401
    assert TestClient(app).get("/api/v1/ocr/records").status_code == 401
