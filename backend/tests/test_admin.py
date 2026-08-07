"""系统管理测试（P7，L2 门禁）：用户/角色/权限/日志/备份 + 保护规则。"""
from __future__ import annotations

import gzip
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.services.backup import backup_dir

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _login_tester() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.status_code == 200 and r.json()["code"] == 0


# ============================ 用户管理 ============================

def test_user_crud_and_protections() -> None:
    _login_admin()
    uname = f"mg{_TAG}"
    # 创建
    r = client.post("/api/v1/users", json={
        "username": uname, "password": "pass123", "real_name": "管理测试", "phone": "13800000000", "role_id": 2,
    })
    assert r.json()["code"] == 0, r.text
    uid = r.json()["data"]["id"]
    # 重名
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "role_id": 2})
    assert r.json()["code"] == 4006
    # 角色不存在
    r = client.post("/api/v1/users", json={"username": f"mg2{_TAG}", "password": "pass123", "role_id": 999999})
    assert r.json()["code"] == 4006
    # 列表含新用户
    r = client.get(f"/api/v1/users?keyword={uname}")
    assert r.json()["data"]["total"] == 1
    row = r.json()["data"]["list"][0]
    assert row["role_name"] == "管理者" and row["status"] == 1
    # 修改：改姓名电话 + 重置密码
    r = client.put(f"/api/v1/users/{uid}", json={"real_name": "改名", "phone": "13900000000", "password": "newpass6"})
    assert r.json()["code"] == 0
    # 新密码可登录
    r = client.post("/api/v1/auth/login", json={"username": uname, "password": "newpass6"})
    assert r.json()["code"] == 0
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    # 停用后不能登录
    r = client.put(f"/api/v1/users/{uid}", json={"status": 0})
    assert r.json()["code"] == 0
    r = client.post("/api/v1/auth/login", json={"username": uname, "password": "newpass6"})
    assert r.json()["code"] == 4004
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    # 保护：admin(1) 不可停用
    r = client.put("/api/v1/users/1", json={"status": 0})
    assert r.json()["code"] == 4006
    # 保护：不能停用自己（admin 操作 admin）
    r = client.delete("/api/v1/users/1")
    assert r.json()["code"] == 4006
    # 删除（停用）新用户
    r = client.delete(f"/api/v1/users/{uid}")
    assert r.json()["code"] == 0


def test_self_role_protection() -> None:
    _login_admin()
    r = client.put("/api/v1/users/1", json={"role_id": 4})
    assert r.json()["code"] == 4006  # 不能改自己角色（防锁死）


# ============================ 角色与权限 ============================

def test_role_crud_and_permissions() -> None:
    _login_admin()
    code = f"rp{_TAG}"
    r = client.post("/api/v1/roles", json={"code": code, "name": "测试角色", "description": "t"})
    assert r.json()["code"] == 0, r.text
    rid = r.json()["data"]["id"]
    # 重名编码
    r = client.post("/api/v1/roles", json={"code": code, "name": "x"})
    assert r.json()["code"] == 4006
    # 修改
    r = client.put(f"/api/v1/roles/{rid}", json={"name": "测试角色2"})
    assert r.json()["code"] == 0
    # 分配权限：库存查询(8) + 领用申请(13)
    r = client.put(f"/api/v1/roles/{rid}/permissions", json={"permission_ids": [8, 13]})
    assert r.json()["code"] == 0
    rows = client.get("/api/v1/roles").json()["data"]
    role = next(x for x in rows if x["id"] == rid)
    assert set(role["permission_codes"]) == {"stk:query", "req:apply"}
    # 无效权限点
    r = client.put(f"/api/v1/roles/{rid}/permissions", json={"permission_ids": [999999]})
    assert r.json()["code"] == 4006
    # 保护：super_admin 角色权限不可改
    r = client.put("/api/v1/roles/1/permissions", json={"permission_ids": [8]})
    assert r.json()["code"] == 4006
    # 权限点列表
    perms = client.get("/api/v1/permissions").json()["data"]
    assert any(p["code"] == "sys:user" for p in perms)
    # 保护：内置角色不可删
    r = client.delete("/api/v1/roles/1")
    assert r.json()["code"] == 4006
    # 删除新角色
    r = client.delete(f"/api/v1/roles/{rid}")
    assert r.json()["code"] == 0
    # 保护：有启用用户引用的角色不可删
    r = client.delete("/api/v1/roles/4")  # 使用者角色（tester_user 在用）
    assert r.json()["code"] == 4006


def test_role_permission_effective() -> None:
    """新角色权限分配后，该角色用户登录即拥有对应权限。"""
    _login_admin()
    code = f"pe{_TAG}"
    r = client.post("/api/v1/roles", json={"code": code, "name": "权限生效测试"})
    rid = r.json()["data"]["id"]
    client.put(f"/api/v1/roles/{rid}/permissions", json={"permission_ids": [8]})  # 仅库存查询
    uname = f"peuser{_TAG}"
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "role_id": rid})
    uid = r.json()["data"]["id"]
    r = client.post("/api/v1/auth/login", json={"username": uname, "password": "pass123"})
    assert r.json()["code"] == 0
    me = client.get("/api/v1/auth/me").json()["data"]["user"]
    assert set(me["permissions"]) == {"stk:query"}
    # 无 sys:user 权限 → 访问用户管理被拒
    assert client.get("/api/v1/users").json()["code"] == 4005
    assert client.get("/api/v1/logs").json()["code"] == 4005
    # 清理
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    client.delete(f"/api/v1/users/{uid}")
    client.delete(f"/api/v1/roles/{rid}")


# ============================ 操作日志 ============================

def test_operation_logs() -> None:
    _login_admin()
    # 制造写操作（复用规范单位，避免随机单位名污染单位表）
    if not any(u["name"] == "件" for u in client.get("/api/v1/units").json()["data"]):
        client.post("/api/v1/units", json={"name": "件"})
    r = client.get(f"/api/v1/logs?username=admin&page=1&page_size=5")
    assert r.json()["code"] == 0, r.text
    d = r.json()["data"]
    assert d["total"] >= 1
    assert d["list"][0]["username"] == "admin"
    assert d["list"][0]["module"]  # 模块名非空
    assert d["list"][0]["method"] in ("POST", "PUT", "DELETE")
    # 过滤不存在的用户名 → 空
    r = client.get("/api/v1/logs?username=__no_such_user__")
    assert r.json()["data"]["total"] == 0


# ============================ 备份 ============================

def test_backup_flow() -> None:
    _login_admin()
    r = client.post("/api/v1/backups")
    assert r.json()["code"] == 0, r.text
    data = r.json()["data"]
    assert data["file_path"].endswith(".sql.gz")
    # 文件真实存在且可解压（gzip 魔数）
    f = backup_dir() / data["file_path"]
    assert f.exists() and f.stat().st_size > 0
    with gzip.open(f, "rb") as gz:
        head = gz.read(64)
    assert b"MySQL dump" in head or b"mysqldump" in head.lower() or b"--" in head
    # 列表
    r = client.get("/api/v1/backups?page=1&page_size=20")
    rows = r.json()["data"]["list"]
    assert any(x["id"] == data["id"] and x["backup_type"] == "manual" for x in rows)
    # 下载
    r = client.get(f"/api/v1/backups/{data['id']}/download")
    assert r.status_code == 200 and r.content[:2] == b"\x1f\x8b"  # gzip
    # 删除：记录 + 文件
    r = client.delete(f"/api/v1/backups/{data['id']}")
    assert r.json()["code"] == 0
    assert not f.exists()
    # 不存在
    r = client.delete("/api/v1/backups/99999999")
    assert r.json()["code"] == 4003


# ============================ 权限 ============================

def test_admin_permission_denied() -> None:
    _login_tester()  # 使用者角色无任何系统管理权限
    for path in ("/api/v1/users", "/api/v1/roles", "/api/v1/permissions", "/api/v1/logs", "/api/v1/backups"):
        r = client.get(path)
        assert r.json()["code"] == 4005, path
    r = client.post("/api/v1/backups")
    assert r.json()["code"] == 4005
