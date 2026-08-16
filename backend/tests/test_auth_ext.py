"""认证增强测试（修改密码/验证码/找回/注册）+ 单位货架（P9，本轮需求）。"""
from __future__ import annotations

import base64
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models.sys import SysConfig

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _set_cfg(key: str, value: str) -> None:
    db = SessionLocal()
    try:
        row = db.query(SysConfig).filter(SysConfig.config_key == key).first()
        if row:
            row.config_value = value
        else:
            db.add(SysConfig(config_key=key, config_value=value, remark="test"))
        db.commit()
    finally:
        db.close()


def _setup_wh_shelf() -> tuple[int, int]:
    """建仓库+2 货架，返回 (wh_id, shelf_id)。"""
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "DP" + tag, "name": "单位仓"})
    wh = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh, "code": "S1"})
    s1 = r.json()["data"]["id"]
    client.post("/api/v1/shelves", json={"warehouse_id": wh, "code": "S2"})
    return wh, s1


# ============================ 修改密码 ============================

def test_change_password() -> None:
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    uname = f"cp{tag}"
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "role_id": 4})
    uid = r.json()["data"]["id"]
    # 登录后改密
    c = TestClient(app)
    c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123"})
    assert c.put("/api/v1/auth/password", json={"old_password": "wrong1", "new_password": "newpass6"}).json()["code"] == 4006
    r = c.put("/api/v1/auth/password", json={"old_password": "pass123", "new_password": "newpass6"})
    assert r.json()["code"] == 0, r.text
    # 旧密码失效、新密码可登录
    c.post("/api/v1/auth/logout")
    assert c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123"}).json()["code"] == 4004
    assert c.post("/api/v1/auth/login", json={"username": uname, "password": "newpass6"}).json()["code"] == 0
    # 清理
    _login_admin()
    client.delete(f"/api/v1/users/{uid}")


# ============================ 登录验证码 ============================

def test_login_captcha_after_3_fails() -> None:
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    uname = f"cpca{tag}"
    r = client.post("/api/v1/users", json={"username": uname, "password": "pass123", "role_id": 4})
    uid = r.json()["data"]["id"]
    c = TestClient(app)
    # 前 3 次失败：仅提示密码错误
    for _ in range(3):
        r = c.post("/api/v1/auth/login", json={"username": uname, "password": "bad"})
        assert r.json()["code"] == 4004
    # 第 4 次：要求验证码
    r = c.post("/api/v1/auth/login", json={"username": uname, "password": "bad"})
    assert r.json()["code"] == 4007
    # 不带验证码且密码正确 → 仍要求验证码
    r = c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123"})
    assert r.json()["code"] == 4007
    # 取验证码 → 图片可解码；先读服务端内存中的正确码（后续错误尝试会消耗该验证码）
    from app.api.auth import _captchas

    cap = c.get("/api/v1/auth/captcha").json()["data"]
    assert cap["captcha_id"] and cap["image"]
    base64.b64decode(cap["image"])
    good_code = _captchas[cap["captcha_id"]][0]
    # 错误验证码 → 4007（并消耗该验证码）
    r = c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123", "captcha_id": cap["captcha_id"], "captcha_code": "XXXX"})
    assert r.json()["code"] == 4007
    # 重新取验证码，用正确码登录成功
    cap2 = c.get("/api/v1/auth/captcha").json()["data"]
    good_code2 = _captchas[cap2["captcha_id"]][0]
    r = c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123", "captcha_id": cap2["captcha_id"], "captcha_code": good_code2})
    assert r.json()["code"] == 0, r.text
    # 成功后计数清零：下次直接登录无需验证码
    c.post("/api/v1/auth/logout")
    r = c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123"})
    assert r.json()["code"] == 0
    # 清理
    _login_admin()
    client.delete(f"/api/v1/users/{uid}")


# ============================ 找回密码 ============================

def test_forgot_phone_default() -> None:
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    uname = f"fg{tag}"
    client.post("/api/v1/users", json={"username": uname, "password": "pass123", "role_id": 4})
    _set_cfg("auth.forgot_method", "phone")
    _set_cfg("site.contact_phone", "13800001111")
    c = TestClient(app)
    r = c.post("/api/v1/auth/forgot", json={"username": uname})
    assert r.json()["code"] == 0, r.text
    assert r.json()["data"]["contact_phone"] == "13800001111"
    # 未配置电话 → 4006
    _set_cfg("site.contact_phone", "")
    r = c.post("/api/v1/auth/forgot", json={"username": uname})
    assert r.json()["code"] == 4006
    # 账号不存在
    r = c.post("/api/v1/auth/forgot", json={"username": "no_such_user_xyz"})
    assert r.json()["code"] == 4006


def test_forgot_email_requires_smtp() -> None:
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    uname = f"fge{tag}"
    client.post("/api/v1/users", json={"username": uname, "password": "pass123", "role_id": 4, "email": f"{uname}@test.local"})
    _set_cfg("auth.forgot_method", "email")
    _set_cfg("smtp.host", "")  # 未配置 SMTP
    c = TestClient(app)
    # 邮箱不匹配：防枚举，返回与账号不存在同构的成功响应（不发送验证码）
    r = c.post("/api/v1/auth/forgot", json={"username": uname, "email": "x@y.z"})
    assert r.json()["code"] == 0, r.text
    assert r.json()["data"]["method"] == "email"
    # 邮箱匹配但 SMTP 未配置
    r = c.post("/api/v1/auth/forgot", json={"username": uname, "email": f"{uname}@test.local"})
    assert r.json()["code"] == 4006
    assert "SMTP" in r.json()["message"]


# ============================ 注册 ============================

def test_register_modes() -> None:
    _login_admin()
    tag = uuid.uuid4().hex[:6]
    uname = f"reg{tag}"
    # 默认 closed
    _set_cfg("auth.register_mode", "closed")
    r = client.post("/api/v1/auth/register", json={"username": uname, "password": "pass123", "real_name": "注册用户"})
    assert r.json()["code"] == 4006
    # status 接口
    assert client.get("/api/v1/auth/register/status").json()["data"]["mode"] == "closed"
    # open：直接注册成功并可登录
    _set_cfg("auth.register_mode", "open")
    r = client.post("/api/v1/auth/register", json={"username": uname, "password": "pass123", "real_name": "注册用户", "email": f"{uname}@t.local"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "approved", r.text
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123"})
    assert r.json()["code"] == 0
    me = c.get("/api/v1/auth/me").json()["data"]["user"]
    assert me["role"]["code"] == "user"  # 默认使用者角色
    # 重名
    assert client.post("/api/v1/auth/register", json={"username": uname, "password": "pass123"}).json()["code"] == 4006
    # review：进审核队列 → 管理员通过后可登录
    _set_cfg("auth.register_mode", "review")
    uname2 = f"reg2{tag}"
    r = client.post("/api/v1/auth/register", json={"username": uname2, "password": "pass123", "real_name": "待审用户"})
    assert r.json()["code"] == 0 and r.json()["data"]["status"] == "review"
    c2 = TestClient(app)
    assert c2.post("/api/v1/auth/login", json={"username": uname2, "password": "pass123"}).json()["code"] == 4004  # 未通过不可登录
    # 管理员列表 + 通过
    applies = client.get("/api/v1/register-applies?status=0").json()["data"]["list"]
    aid = next(a for a in applies if a["username"] == uname2)["id"]
    r = client.post(f"/api/v1/register-applies/{aid}/approve")
    assert r.json()["code"] == 0, r.text
    assert c2.post("/api/v1/auth/login", json={"username": uname2, "password": "pass123"}).json()["code"] == 0
    # 拒绝流程
    uname3 = f"reg3{tag}"
    client.post("/api/v1/auth/register", json={"username": uname3, "password": "pass123"})
    applies = client.get("/api/v1/register-applies?status=0").json()["data"]["list"]
    aid3 = next(a for a in applies if a["username"] == uname3)["id"]
    assert client.post(f"/api/v1/register-applies/{aid3}/reject").json()["code"] == 0
    c3 = TestClient(app)
    assert c3.post("/api/v1/auth/login", json={"username": uname3, "password": "pass123"}).json()["code"] == 4004
    # 已处理不可再审
    assert client.post(f"/api/v1/register-applies/{aid3}/approve").json()["code"] == 4002
    # 使用者无审核权限（403 + 4005）
    r = c.get("/api/v1/register-applies")
    assert r.status_code == 403 and r.json()["code"] == 4005
    # 清理
    _login_admin()
    for u in (uname, uname2):
        rows = client.get(f"/api/v1/users?keyword={u}").json()["data"]["list"]
        for x in rows:
            client.delete(f"/api/v1/users/{x['id']}")
    _set_cfg("auth.register_mode", "closed")


# ============================ 单位与货架 ============================

def test_department_and_shelf_visibility() -> None:
    _login_admin()
    wh, s1 = _setup_wh_shelf()
    tag = uuid.uuid4().hex[:6]
    # 建单位 + 关联货架 s1
    r = client.post("/api/v1/departments", json={"code": "DPT" + tag, "name": "机加车间"})
    dept = r.json()["data"]["id"]
    r = client.put(f"/api/v1/departments/{dept}/shelves", json={"shelf_ids": [s1]})
    assert r.json()["code"] == 0, r.text
    # 单位列表含关联
    rows = client.get("/api/v1/departments").json()["data"]
    d = next(x for x in rows if x["id"] == dept)
    assert d["shelf_ids"] == [s1]
    # 建角色（所属单位）+ 用户
    r = client.post("/api/v1/roles", json={"code": "dp" + tag, "name": "机加角色", "department_id": dept})
    rid = r.json()["data"]["id"]
    roles = client.get("/api/v1/roles").json()["data"]
    assert next(x for x in roles if x["id"] == rid)["department_name"] == "机加车间"
    uname = f"deptuser{tag}"
    client.post("/api/v1/users", json={"username": uname, "password": "pass123", "role_id": rid})
    # 该用户登录后：货架列表仅见 s1
    c = TestClient(app)
    c.post("/api/v1/auth/login", json={"username": uname, "password": "pass123"})
    shelves = c.get(f"/api/v1/warehouses/{wh}/shelves").json()["data"]
    assert [s["id"] for s in shelves] == [s1]
    # admin 全量可见
    shelves_all = client.get(f"/api/v1/warehouses/{wh}/shelves").json()["data"]
    assert len(shelves_all) == 2
    # 保护：单位下还有角色不可删
    assert client.delete(f"/api/v1/departments/{dept}").json()["code"] == 4006
    # 清理
    client.delete(f"/api/v1/users/{client.get(f'/api/v1/users?keyword={uname}').json()['data']['list'][0]['id']}")
    client.delete(f"/api/v1/roles/{rid}")
    assert client.delete(f"/api/v1/departments/{dept}").json()["code"] == 0
