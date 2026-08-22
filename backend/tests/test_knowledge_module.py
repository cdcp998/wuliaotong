"""knowledge 模块（P4，L2 门禁）：草稿/发布版本/归档/物料关联/检索/AI 生成异步状态机/任务推荐联动。

前置：cable/task/knowledge 安装启用（本模块 fixture）；AI 生成 worker 直接调用 tick 函数验证
状态机（不依赖真实大模型——未配置时走 failed 分支）。
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login(username: str, password: str) -> None:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200 and r.json()["code"] == 0, r.text


@pytest.fixture(scope="module", autouse=True)
def _ensure_modules():
    _login("admin", "admin123")
    for code in ("cable", "map", "task", "knowledge"):
        client.post(f"/api/v1/modules/{code}/install")
    for code in ("map", "cable", "task", "knowledge"):
        r = client.post(f"/api/v1/modules/{code}/enable")
        assert r.json()["code"] == 0, r.text
    yield


def _mk_draft(title: str) -> int:
    r = client.post("/api/v1/knowledge", json={
        "title": title, "content": f"# {title}\n\n## 故障现象\nT-测试内容，涉及光缆接线盒进水。",
        "category": "光缆", "tags": ["接线盒", "进水"],
    })
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]["id"]


def test_article_draft_publish_archive_and_visibility() -> None:
    _login("admin", "admin123")
    aid = _mk_draft("T-接线盒进水处理")
    # 草稿：超管可见；执行搜索（已发布过滤）
    r = client.get(f"/api/v1/knowledge/{aid}")
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == 0

    # 发布 → revision 快照 + published_version
    r = client.post(f"/api/v1/knowledge/{aid}/publish")
    assert r.json()["code"] == 0
    data = r.json()["data"]
    assert data["status"] == 1 and data["published_version"] == 1
    # 再发布（无变更）→ 幂等
    r = client.post(f"/api/v1/knowledge/{aid}/publish")
    assert r.json()["code"] == 0 and r.json()["data"]["version"] == 1

    # 已发布知识：普通维修人员（knowledge:view）可见
    uname = f"fg{_TAG}{uuid.uuid4().hex[:4]}"
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "real_name": "维修工", "role_id": 6})
    assert r.json()["code"] == 0
    _login(uname, "pass123")
    r = client.get(f"/api/v1/knowledge/{aid}")
    assert r.json()["code"] == 0

    # 编辑（作者/审核人）→ 回到草稿 + 版本 +1
    _login("admin", "admin123")
    r = client.put(f"/api/v1/knowledge/{aid}", json={"content": "# T-更新内容\n\n补充：更换密封圈。"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == 0 and r.json()["data"]["version"] == 2

    # 归档 → 普通用户（维修人员）已发布列表不再可见
    r = client.post(f"/api/v1/knowledge/{aid}/archive")
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == 2
    _login(uname, "pass123")
    r = client.get("/api/v1/knowledge", params={"page_size": 100})
    assert all(x["id"] != aid for x in r.json()["data"]["items"])
    r = client.get(f"/api/v1/knowledge/{aid}")
    assert r.json()["code"] == 4003  # 归档且非作者 → 不可见


def test_search_and_material_link() -> None:
    _login("admin", "admin123")
    aid = _mk_draft("T-光缆接头熔接工艺")
    client.post(f"/api/v1/knowledge/{aid}/publish")

    # 检索（RAG-lite：标题/正文命中）
    r = client.post("/api/v1/knowledge/search", json={"keyword": "熔接"})
    assert r.json()["code"] == 0
    assert any(i["id"] == aid for i in r.json()["data"]["items"])

    # 物料关联（复用 base_product 现有数据；无则跳过）
    from app.db import SessionLocal
    from sqlalchemy import text

    db = SessionLocal()
    try:
        prod = db.execute(text("SELECT id FROM base_product WHERE status = 1 LIMIT 1")).fetchone()
    finally:
        db.close()
    if not prod:
        return
    r = client.post(f"/api/v1/knowledge/{aid}/materials", json={"product_id": prod[0]})
    assert r.json()["code"] == 0
    r = client.get(f"/api/v1/knowledge/materials/{prod[0]}")
    assert r.json()["code"] == 0 and any(i["id"] == aid for i in r.json()["data"]["items"])


def test_ai_generate_async_state_machine() -> None:
    """AI 生成：入队 → worker tick（未配置模型 → 重试 2 次后 failed，状态机完整）。"""
    _login("admin", "admin123")
    r = client.post("/api/v1/knowledge/generate", json={"title": "T-AI生成", "topic": "T-测试光缆故障处理", "context": "T-现场描述"})
    assert r.json()["code"] == 0
    task_id = r.json()["data"]["task_id"]

    from app.modules.knowledge.services.ai_generate import knowledge_worker_tick

    # 直接驱动 worker（隔离库内模块已启用；未配置 LLM → 失败重试路径）
    for _ in range(6):
        knowledge_worker_tick()
        st = client.get(f"/api/v1/knowledge/generate/{task_id}").json()["data"]
        if st["status"] in ("success", "failed"):
            break
    assert st["status"] in ("success", "failed")
    assert st["retry_count"] <= 2
    if st["status"] == "failed":
        assert st["last_error"]  # 未配置模型时的错误信息（LLMNotConfigured/网络等）
    # 已终态：worker 不再处理
    knowledge_worker_tick()
    st2 = client.get(f"/api/v1/knowledge/generate/{task_id}").json()["data"]
    assert st2["status"] == st["status"]


def test_task_knowledge_recommend_integration() -> None:
    """任务→知识推荐：knowledge 启用 + 故障类型命中 → 返回已发布文章（跨模块服务调用）。"""
    _login("admin", "admin123")
    aid = _mk_draft("T-光纤断芯处理手册")
    r = client.put(f"/api/v1/knowledge/{aid}", json={"related_fault_types": ["断芯"]})
    assert r.json()["code"] == 0
    assert client.post(f"/api/v1/knowledge/{aid}/publish").json()["code"] == 0

    # 任务（故障类型=断芯）
    f = client.post("/api/v1/faults", json={"lat": 30.09, "lng": 120.09, "fault_type": "断芯", "severity": 1, "description": "T-推荐测试"})
    assert f.json()["code"] == 0
    t = client.post("/api/v1/tasks", json={"fault_id": f.json()["data"]["id"], "title": "T-光缆断芯修复"})
    assert t.json()["code"] == 0
    r = client.post(f"/api/v1/tasks/{t.json()['data']['id']}/knowledge-recommend")
    assert r.json()["code"] == 0
    items = r.json()["data"]["items"]
    assert any(i["id"] == aid for i in items), items
