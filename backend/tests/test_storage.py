"""多存储地址测试（L2 门禁）。

覆盖：存储位置 CRUD、fill 最空闲策略落盘、manual 指定存储、round 轮询、
文件读取、删除保护（有文件的存储禁删）、权限（非 sys:config 403）。
每个测试先停用全部存储，保证选择策略的确定性（不受历史数据干扰）。
"""
import io
import uuid

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _disable_all_storages() -> None:
    from app.db import SessionLocal
    from app.models.sys import SysStorage

    db = SessionLocal()
    try:
        for s in db.query(SysStorage).all():
            s.status = 0
        db.commit()
    finally:
        db.close()


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (100, 80), color=(200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _upload(storage_id: int = 0) -> dict:
    r = client.post(
        f"/api/v1/files/upload?biz_type=test&storage_id={storage_id}",
        files={"file": ("a.png", _png_bytes(), "image/png")},
    )
    assert r.json()["code"] == 0, r.text
    return r.json()["data"]


def test_storage_crud_and_upload():
    _login_admin()
    _disable_all_storages()

    # 新增两个 fill 存储
    r = client.post("/api/v1/storages", json={"name": f"存A{_TAG}", "path": f"tests/_tmp/{_TAG}/a", "policy": "fill"})
    assert r.json()["code"] == 0, r.text
    s1 = r.json()["data"]["id"]
    r = client.post("/api/v1/storages", json={"name": f"存B{_TAG}", "path": f"tests/_tmp/{_TAG}/b", "policy": "fill"})
    s2 = r.json()["data"]["id"]
    assert r.json()["code"] == 0

    # fill：两个存储均 0 文件 → 取 id 小的（s1）
    d1 = _upload()
    assert d1["storage_id"] == s1
    # s1 已有文件 → 第二次应落到 s2
    d2 = _upload()
    assert d2["storage_id"] == s2

    # 读取文件（按实际文件类型返回 Content-Type，不再写死 webp）
    r = client.get(f"/api/v1/files/{d1['file_id']}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/")
    # 404
    assert client.get("/api/v1/files/999999").json()["code"] == 4003

    # 有文件的存储禁止删除
    assert client.delete(f"/api/v1/storages/{s1}").json()["code"] == 4006
    # 空存储可删
    r = client.post("/api/v1/storages", json={"name": f"存C{_TAG}", "path": f"tests/_tmp/{_TAG}/c"})
    s3 = r.json()["data"]["id"]
    assert client.delete(f"/api/v1/storages/{s3}").json()["code"] == 0

    # 停用 s1 后 → 上传落 s2
    st = client.get("/api/v1/storages").json()["data"]
    info1 = next(x for x in st if x["id"] == s1)
    r = client.put(
        f"/api/v1/storages/{s1}",
        json={"name": info1["name"], "path": info1["path"], "policy": "fill", "is_default": info1["is_default"], "status": 0},
    )
    assert r.json()["code"] == 0, r.text
    assert _upload()["storage_id"] == s2

    # 健康检测
    health = client.get("/api/v1/storages/health").json()["data"]
    assert any(h["id"] == s2 and h["exists"] and h["writable"] for h in health)


def test_storage_manual_and_round():
    _login_admin()
    _disable_all_storages()

    # manual 策略存储 + 指定 storage_id
    r = client.post("/api/v1/storages", json={"name": f"手动{_TAG}", "path": f"tests/_tmp/{_TAG}/m", "policy": "manual"})
    sid = r.json()["data"]["id"]
    assert r.json()["code"] == 0
    assert _upload(storage_id=sid)["storage_id"] == sid
    # 指定不存在的存储 → 4006
    assert client.post(
        "/api/v1/files/upload?storage_id=999999",
        files={"file": ("a.png", _png_bytes(), "image/png")},
    ).json()["code"] == 4006

    # round 轮询：新建两个 round 存储（唯一启用），连续两次上传应交替
    r1 = client.post("/api/v1/storages", json={"name": f"轮A{_TAG}", "path": f"tests/_tmp/{_TAG}/r1", "policy": "round", "is_default": 1})
    r2 = client.post("/api/v1/storages", json={"name": f"轮B{_TAG}", "path": f"tests/_tmp/{_TAG}/r2", "policy": "round"})
    ra, rb = r1.json()["data"]["id"], r2.json()["data"]["id"]
    assert r1.json()["code"] == 0 and r2.json()["code"] == 0

    # 清空轮询计数，保证可断言
    from app.db import SessionLocal
    from app.models.sys import SysConfig

    db = SessionLocal()
    try:
        cfg = db.query(SysConfig).filter(SysConfig.config_key == "storage.round_seq").first()
        if cfg:
            cfg.config_value = "0"
            db.commit()
    finally:
        db.close()

    u1 = _upload()
    u2 = _upload()
    assert {u1["storage_id"], u2["storage_id"]} == {ra, rb}  # 两次落到不同存储
    assert u1["storage_id"] != u2["storage_id"]


def test_storage_permission():
    # 无 sys:config 权限（使用者）→ 403
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.json()["code"] == 0
    assert c.get("/api/v1/storages").status_code == 403
    # 未登录 → 401
    assert TestClient(app).get("/api/v1/storages").status_code == 401
    # 但上传文件任何登录用户可用（使用者提交领用照片）
    r = c.post(
        "/api/v1/files/upload?biz_type=test",
        files={"file": ("a.png", _png_bytes(), "image/png")},
    )
    assert r.json()["code"] == 0
