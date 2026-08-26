"""领用流程测试（P3，L2 门禁）。

覆盖：使用者申请（必填校验）、我的申请、仓管员审计通过（扣库存+流水+通知）、
库存不足整单回滚、驳回→修改重提、取消、权限（user 不能审计 / 越权查看 403）。
"""
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
_TAG = uuid.uuid4().hex[:6]


def _login_admin() -> None:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200 and r.json()["code"] == 0


def _login_tester() -> TestClient:
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": "tester_user", "password": "123456"})
    assert r.json()["code"] == 0
    return c


def _setup_stock(qty: str = "50") -> tuple[int, int, int]:
    """建 仓库+库位+商品并入库 qty 件，返回 (warehouse_id, location_id, product_id)。"""
    tag = uuid.uuid4().hex[:6]
    r = client.post("/api/v1/warehouses", json={"code": "WH" + tag, "name": "P3仓"})
    wh_id = r.json()["data"]["id"]
    r = client.post("/api/v1/shelves", json={"warehouse_id": wh_id, "code": "A1"})
    shelf_id = r.json()["data"]["id"]
    r = client.post("/api/v1/locations", json={"warehouse_id": wh_id, "shelf_id": shelf_id, "layer_no": 1})
    loc_id = r.json()["data"]["id"]

    unit_id = client.get("/api/v1/units").json()["data"][0]["id"]
    r = client.post("/api/v1/products", json={"code": "9" + str(int(tag, 16) % 10**9), "name": "P3物料", "unit_id": unit_id})
    pid = r.json()["data"]["id"]

    r = client.post("/api/v1/purchase-in", json={
        "warehouse_id": wh_id, "items": [{"product_id": pid, "qty": qty, "price": "1.00", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    return wh_id, loc_id, pid


def _stock_qty(product_id: int) -> str:
    rows = client.get(f"/api/v1/stock?product_id={product_id}").json()["data"]["list"]
    return rows[0]["qty"] if rows else "0"


def test_requisition_full_flow():
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("50")
    c = _login_tester()

    # 使用者申请（必填项校验：缺使用地点 → 4006）
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_reason": "维修设备",
        "items": [{"product_id": pid, "qty": "10", "location_id": loc_id}],
    })
    assert r.json()["code"] == 4006

    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "三号车间", "use_reason": "维修设备",
        "location_photo_file_id": 12345,
        "items": [{"product_id": pid, "qty": "10", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    req_id = r.json()["data"]["id"]
    bill_no = r.json()["data"]["bill_no"]
    assert bill_no.startswith("LL") and r.json()["data"]["status"] == 1

    # 提交即自动出库：库存 50-10=40、流水、使用地点照片已保存
    assert _stock_qty(pid) == "40.000"
    flow = client.get(f"/api/v1/stock/flow?product_id={pid}").json()["data"]["list"]
    assert flow[0]["change_type"] == "领用出库" and flow[0]["change_qty"] == "-10.000"

    # 我的申请（历史累积，断言最新一条为本单）
    mine = c.get("/api/v1/requisitions/my").json()["data"]
    assert mine["total"] >= 1 and mine["list"][0]["id"] == req_id

    # 仓管员（admin）列表：待完成工作（1）不在待审计（2）
    lst = client.get("/api/v1/requisitions?status=1").json()["data"]
    assert any(x["id"] == req_id for x in lst["list"])

    # 未完成工作前不可审计 → 4002
    assert client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "approve"}).json()["code"] == 4002

    # 完成工作拍照（上传 + 手机定位）→ 待审计（2）
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (80, 60)).save(buf, format="PNG")
    up = c.post("/api/v1/files/upload?biz_type=requisition_work", files={"file": ("w.png", buf.getvalue(), "image/png")})
    assert up.json()["code"] == 0, up.text
    photo_id = up.json()["data"]["file_id"]
    r = c.post(f"/api/v1/requisitions/{req_id}/work-done", json={"photo_file_id": photo_id, "lat": "31.2304", "lng": "121.4737"})
    assert r.json()["code"] == 0, r.text
    detail = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert detail["status"] == 2 and detail["work_photo_file_id"] == photo_id
    assert detail["work_lat"] == "31.2304" and detail["work_done_at"]

    # 待审计列表（2）可查到；重复提交完成工作 → 4002
    lst = client.get("/api/v1/requisitions?status=2").json()["data"]
    assert any(x["id"] == req_id for x in lst["list"])
    assert c.post(f"/api/v1/requisitions/{req_id}/work-done", json={"photo_file_id": photo_id}).json()["code"] == 4002

    # 水印下载：动态添加水印（原始照片不保存水印），PNG 且体积大于原图
    wm = client.get(f"/api/v1/requisitions/{req_id}/work-photo")
    assert wm.status_code == 200 and wm.headers["content-type"].startswith("image/png")
    assert len(wm.content) > len(buf.getvalue())

    # 审计通过 → 仅确认状态（库存已扣），申请人收到通知；状态 3 已完成
    r = client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "approve", "remark": "同意"})
    assert r.json()["code"] == 0, r.text
    assert _stock_qty(pid) == "40.000"
    # 详情含审计信息 + 使用地点照片
    detail = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert detail["status"] == 3 and detail["audit_name"] == "超级管理员"
    assert detail["location_photo_file_id"] == 12345
    # 申请人通知
    notif = c.get("/api/v1/notifications").json()["data"]
    assert notif["total"] >= 1 and any("已通过" in n["title"] for n in notif["list"])

    # 已审计不可再审 → 4002
    assert client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "reject"}).json()["code"] == 4002


def test_requisition_negative_stock_notifies_admin():
    """库存不足不再拦截：自动出库允许负库存（实物与系统账可能不符），并通知管理员核对。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("5")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "一车间", "use_reason": "领 10 件",
        "items": [{"product_id": pid, "qty": "10", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    # 库存 5 - 10 = -5（负库存出库成功）
    assert _stock_qty(pid) == "-5.000"
    # 响应带 shortage 提示
    assert r.json()["data"]["shortages"]
    # 管理员（admin 为超管）收到库存不足通知
    notif = client.get("/api/v1/notifications").json()["data"]
    assert any("库存不足" in n["title"] for n in notif["list"])
    # 完成工作后审计仍可正常通过（状态确认）
    req_id = r.json()["data"]["id"]
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (60, 40)).save(buf, format="PNG")
    up = c.post("/api/v1/files/upload", files={"file": ("w.png", buf.getvalue(), "image/png")})
    assert up.json()["code"] == 0, up.text
    assert c.post(f"/api/v1/requisitions/{req_id}/work-done", json={"photo_file_id": up.json()["data"]["file_id"]}).json()["code"] == 0
    r = client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "approve"})
    assert r.json()["code"] == 0, r.text
    assert _stock_qty(pid) == "-5.000"


def test_requisition_reject_resubmit_cancel():
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("20")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "二车间", "use_reason": "试用",
        "items": [{"product_id": pid, "qty": "2", "location_id": loc_id}],
    })
    req_id = r.json()["data"]["id"]
    assert _stock_qty(pid) == "18.000"  # 提交即自动出库 20-2

    # 驳回前需先完成工作拍照（待审计=2）
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (60, 40)).save(buf, format="PNG")
    up = c.post("/api/v1/files/upload", files={"file": ("w.png", buf.getvalue(), "image/png")})
    assert up.json()["code"] == 0, up.text
    assert c.post(f"/api/v1/requisitions/{req_id}/work-done", json={"photo_file_id": up.json()["data"]["file_id"]}).json()["code"] == 0

    # 驳回 → 状态 4 + 库存回补
    r = client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "reject", "remark": "数量写错"})
    assert r.json()["code"] == 0
    assert client.get(f"/api/v1/requisitions/{req_id}").json()["data"]["status"] == 4
    assert _stock_qty(pid) == "20.000"  # 驳回回补
    flow = client.get(f"/api/v1/stock/flow?product_id={pid}").json()["data"]["list"]
    assert any(f["change_type"] == "领用驳回回补" for f in flow)

    # 修改后重新提交 → 回待完成工作(1) + 清空完成照片 + 再次自动出库
    r = c.put(f"/api/v1/requisitions/{req_id}", json={
        "warehouse_id": wh_id, "use_location": "二车间", "use_reason": "修正后重提",
        "items": [{"product_id": pid, "qty": "3", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    detail = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert detail["status"] == 1 and detail["items"][0]["qty"] == "3.000"
    assert detail["work_photo_file_id"] == 0  # 重提后需重新完成工作拍照
    assert _stock_qty(pid) == "17.000"  # 重提 3 件再次出库

    # 取消（待完成工作）→ 状态 5 + 库存回补
    r = c.post(f"/api/v1/requisitions/{req_id}/cancel")
    assert r.json()["code"] == 0
    assert client.get(f"/api/v1/requisitions/{req_id}").json()["data"]["status"] == 5
    assert _stock_qty(pid) == "20.000"  # 取消回补
    # 已取消不能再审
    assert client.post(f"/api/v1/requisitions/{req_id}/audit", json={"action": "approve"}).json()["code"] == 4002


def test_requisition_permissions():
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("10")
    c = _login_tester()
    # 使用者无审计权限 → 403
    assert c.post("/api/v1/requisitions/1/audit", json={"action": "approve"}).status_code == 403
    assert c.get("/api/v1/requisitions").status_code == 403  # 审计列表
    # 未登录 → 401
    assert TestClient(app).get("/api/v1/requisitions/my").status_code == 401
    # 使用者不能查看别人的申请 → 403（admin 先建一张）
    r = client.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "五车间", "use_reason": "admin 代建",
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    other_id = r.json()["data"]["id"]
    assert c.get(f"/api/v1/requisitions/{other_id}").status_code == 403
    # 本人可见
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "六车间", "use_reason": "本人申请",
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    assert c.get(f"/api/v1/requisitions/{r.json()['data']['id']}").status_code == 200


def test_notification_flow():
    _login_admin()
    c = _login_tester()
    # 直接创建一条本人通知，避免依赖其他用例执行顺序（此前依赖前置用例产生的通知）
    uid = c.get("/api/v1/auth/me").json()["data"]["user"]["id"]
    from app.db import SessionLocal
    from app.models.sys import SysNotification

    db = SessionLocal()
    try:
        db.add(SysNotification(user_id=uid, title="通知测试", content="通知已读流程测试", biz_type="测试"))
        db.commit()
    finally:
        db.close()
    # 直接 DB 插入不走 API 写路径，需显式失效 unread 缓存（30s TTL），否则接口读到旧值
    from app.core.cache import cache_delete

    cache_delete(f"notify:unread:{uid}")
    # 未读数 + 已读标记
    cnt = c.get("/api/v1/notifications/unread-count").json()["data"]["unread_count"]
    assert cnt >= 1
    nid = c.get("/api/v1/notifications?is_read=0").json()["data"]["list"][0]["id"]
    assert c.put(f"/api/v1/notifications/{nid}/read").json()["code"] == 0
    after = c.get("/api/v1/notifications/unread-count").json()["data"]["unread_count"]
    assert after == cnt - 1
    # 全部已读
    assert c.put("/api/v1/notifications/read-all").json()["code"] == 0
    assert c.get("/api/v1/notifications/unread-count").json()["data"]["unread_count"] == 0
    # 用户隔离：他人（admin）不能把 tester 的通知标记已读（404）
    assert client.put(f"/api/v1/notifications/{nid}/read").json()["code"] == 4003


def test_notification_delete_flow():
    """通知删除（单删/批量删/清空）+ 用户隔离（手机端/桌面端同用）。"""
    _login_admin()
    c = _login_tester()
    uid = c.get("/api/v1/auth/me").json()["data"]["user"]["id"]
    from app.db import SessionLocal
    from app.models.sys import SysNotification

    db = SessionLocal()
    try:
        for i in range(3):
            db.add(SysNotification(user_id=uid, title=f"删除测试{i}", content="删除测试", biz_type="测试"))
        db.commit()
    finally:
        db.close()
    from app.core.cache import cache_delete

    cache_delete(f"notify:unread:{uid}")

    # 单条删除
    one = c.get("/api/v1/notifications?is_read=0").json()["data"]["list"][0]
    assert c.delete(f"/api/v1/notifications/{one['id']}").json()["code"] == 0
    assert c.delete(f"/api/v1/notifications/{one['id']}").json()["code"] == 4003  # 已删除/不存在
    # 用户隔离：admin 不能删 tester 的通知
    assert client.delete(f"/api/v1/notifications/{one['id']}").json()["code"] == 4003

    # 批量删除剩余两条
    rest = c.get("/api/v1/notifications?is_read=0").json()["data"]["list"]
    ids = [n["id"] for n in rest if n["title"].startswith("删除测试")]
    assert len(ids) >= 2
    r = c.post("/api/v1/notifications/delete", json={"ids": ids}).json()
    assert r["code"] == 0 and r["data"]["deleted"] == len(ids)
    # 空 id 列表 → 参数错误
    assert c.post("/api/v1/notifications/delete", json={"ids": []}).json()["code"] != 0

    # 清空：再造一条后清空全部
    db = SessionLocal()
    try:
        db.add(SysNotification(user_id=uid, title="清空测试", content="清空测试", biz_type="测试"))
        db.commit()
    finally:
        db.close()
    cache_delete(f"notify:unread:{uid}")
    r = c.delete("/api/v1/notifications").json()
    assert r["code"] == 0 and r["data"]["deleted"] >= 1
    assert c.get("/api/v1/notifications/unread-count").json()["data"]["unread_count"] == 0


def test_requisition_private_hidden_reason():
    """私用触发：因何使用锁定为「私用」；非管理员看到固定掩护值（最近 30 天内未盘点领用单取值），管理员见真实状态并可编辑掩护值。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("30")
    c = _login_tester()

    # 普通领用单（作为掩护值来源）
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "维修车间A线", "use_reason": "维修输送带电机",
        "items": [{"product_id": pid, "qty": "2", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text

    # 私用申请：is_private=1 → 因何使用强制为「私用」，并自动生成固定掩护值
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "私人住所", "use_reason": "私用",
        "is_private": 1,
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    req_id = r.json()["data"]["id"]

    # 管理员视角：真实状态（私用标记 + 因何使用=私用）+ 掩护值返回
    d = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert d["is_private"] == 1 and d["use_reason"] == "私用"
    assert d["display_reason"] and d["display_location"]

    # 非管理员（申请人）视角：看到固定掩护值，无私用标记，看不到真实原因
    d2 = c.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert d2["is_private"] == 0
    assert d2["use_reason"] == d["display_reason"]
    assert d2["use_location"] == d["display_location"]
    assert d2["use_reason"] != "私用"

    # 非管理员不能编辑掩护值（4005 无权限）
    assert c.put(f"/api/v1/requisitions/{req_id}/display", json={
        "display_reason": "x", "display_location": "y",
    }).json()["code"] == 4005

    # 管理员编辑掩护值 → 非管理员看到新值（固定生效）
    assert client.put(f"/api/v1/requisitions/{req_id}/display", json={
        "display_reason": "日常巡检", "display_location": "厂区巡查点",
    }).json()["code"] == 0
    d3 = c.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert d3["use_reason"] == "日常巡检" and d3["use_location"] == "厂区巡查点"

    # 我的申请列表同样脱敏
    mine = c.get("/api/v1/requisitions/my").json()["data"]["list"]
    private_rows = [x for x in mine if x["id"] == req_id]
    assert private_rows and private_rows[0]["use_reason"] == "日常巡检" and private_rows[0]["is_private"] == 0
    # 管理员审计列表可见私用标记
    admin_rows = client.get("/api/v1/requisitions").json()["data"]["list"]
    ap = [x for x in admin_rows if x["id"] == req_id]
    assert ap and ap[0]["is_private"] == 1 and ap[0]["use_reason"] == "私用"

    # 非私用单：管理员看到一致真实值（无私用标记）
    normal_rows = [x for x in client.get("/api/v1/requisitions").json()["data"]["list"] if x["is_private"] == 0]
    assert normal_rows and normal_rows[0]["use_reason"] != "私用"


def test_watermark_position_and_preview():
    """水印位置可配置（下载按位置渲染）；系统设置示例预览 + 真实照片预览 + 越权拦截。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("10")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "三号车间", "use_reason": "水印测试",
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    req_id = r.json()["data"]["id"]

    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (80, 60)).save(buf, format="PNG")
    up = c.post("/api/v1/files/upload", files={"file": ("w.png", buf.getvalue(), "image/png")})
    assert up.json()["code"] == 0, up.text
    photo_id = up.json()["data"]["file_id"]
    assert c.post(f"/api/v1/requisitions/{req_id}/work-done", json={"photo_file_id": photo_id, "lat": "31.2", "lng": "121.4"}).json()["code"] == 0

    # 默认位置（bottom）下载正常
    wm = client.get(f"/api/v1/requisitions/{req_id}/work-photo")
    assert wm.status_code == 200 and wm.headers["content-type"].startswith("image/png")

    # 管理员改水印位置（右上角）→ 下载按新位置渲染不报错；还原
    assert client.put("/api/v1/settings", json={"watermark.position": "top-right"}).json()["code"] == 0
    wm2 = client.get(f"/api/v1/requisitions/{req_id}/work-photo")
    assert wm2.status_code == 200 and wm2.headers["content-type"].startswith("image/png")
    assert client.put("/api/v1/settings", json={"watermark.position": "bottom"}).json()["code"] == 0

    # 系统设置水印预览（示例底图，未保存也可预览）
    pv = client.post("/api/v1/watermark/preview", json={
        "template": "地点：{location}｜时间：{time}｜坐标：{gps}", "position": "bottom-left",
    })
    assert pv.status_code == 200 and pv.headers["content-type"].startswith("image/png")

    # 真实照片水印预览（本人）→ 200
    fp = c.post(f"/api/v1/files/{photo_id}/watermark-preview", json={
        "location": "三号车间", "time": "2026-08-06 10:00", "lat": "31.2", "lng": "121.4",
    })
    assert fp.status_code == 200 and fp.headers["content-type"].startswith("image/png")

    # 越权：使用者预览管理员上传的照片 → 403
    up2 = client.post("/api/v1/files/upload", files={"file": ("a.png", buf.getvalue(), "image/png")})
    assert c.post(f"/api/v1/files/{up2.json()['data']['file_id']}/watermark-preview", json={"location": "x"}).status_code == 403


def test_requisition_delegate_apply():
    """仓管员/管理员代使用者提交领用申请（指定申请人）；普通使用者代申请被拒。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("10")
    c = _login_tester()
    tester_id = c.get("/api/v1/auth/me").json()["data"]["user"]["id"]

    # 管理员可选申请人列表：包含全部启用使用者
    lst = client.get("/api/v1/requisitions/applicants").json()["data"]
    assert any(x["id"] == tester_id for x in lst)

    # 管理员代 tester 申请 → 申请人 = tester
    r = client.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "四号车间", "use_reason": "仓管代申请",
        "applicant_id": tester_id,
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    req_id = r.json()["data"]["id"]
    detail = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert detail["applicant_id"] == tester_id and detail["applicant_name"] == "测试使用者"
    # tester 在自己的申请列表可见该单（后续由 tester 完成工作拍照）
    mine = c.get("/api/v1/requisitions/my").json()["data"]["list"]
    assert any(x["id"] == req_id for x in mine)

    # 普通使用者：申请人列表仅自己；代他人申请 → 403
    lst2 = c.get("/api/v1/requisitions/applicants").json()["data"]
    assert len(lst2) == 1 and lst2[0]["id"] == tester_id
    admin_id = client.get("/api/v1/auth/me").json()["data"]["user"]["id"]
    assert c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "四号车间", "use_reason": "越权代申请",
        "applicant_id": admin_id,
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    }).status_code == 403


def test_requisition_edit_work_location():
    """管理员编辑领用单 GPS 坐标与地点信息（水印/记录用）；非管理员 403。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("10")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "旧地点", "use_reason": "定位编辑测试",
        "items": [{"product_id": pid, "qty": "1", "location_id": loc_id}],
    })
    req_id = r.json()["data"]["id"]

    # 非管理员不能编辑 → 403
    assert c.put(f"/api/v1/requisitions/{req_id}/work-location", json={
        "use_location": "新地点", "lat": "31.23", "lng": "121.47",
    }).status_code == 403

    # 管理员编辑 → 详情与后续水印读取新值
    assert client.put(f"/api/v1/requisitions/{req_id}/work-location", json={
        "use_location": "上海浦东新区金海路", "lat": "31.2304", "lng": "121.4737",
    }).json()["code"] == 0
    d = client.get(f"/api/v1/requisitions/{req_id}").json()["data"]
    assert d["use_location"] == "上海浦东新区金海路"
    assert d["work_lat"] == "31.2304" and d["work_lng"] == "121.4737"

    # 坐标范围校验（geo/reverse 参数非法 → 业务码 4006）
    assert client.get("/api/v1/geo/reverse?lat=999&lng=0").json()["code"] == 4006
    assert client.get("/api/v1/geo/reverse").json()["code"] == 4006


def test_requisition_admin_cancel_and_delete():
    """管理员代为取消（解卡测试导入等申请人无法操作的卡单）+ 仅已取消单可删除（连同明细）。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("10")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "代取消车间", "use_reason": "卡单解卡",
        "items": [{"product_id": pid, "qty": "4", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    req_id = r.json()["data"]["id"]
    assert _stock_qty(pid) == "6.000"  # 提交即出库

    # 未取消前不可删除 → 4002
    assert client.delete(f"/api/v1/requisitions/{req_id}").json()["code"] == 4002

    # 管理员代为取消（非申请人）→ 成功 + 库存回补 + 申请人收到通知
    assert client.post(f"/api/v1/requisitions/{req_id}/cancel").json()["code"] == 0
    assert client.get(f"/api/v1/requisitions/{req_id}").json()["data"]["status"] == 5
    assert _stock_qty(pid) == "10.000"
    notif = c.get("/api/v1/notifications").json()["data"]
    assert any("代为取消" in n["content"] for n in notif["list"])

    # 普通使用者无审计权限不能删除 → 403
    assert c.delete(f"/api/v1/requisitions/{req_id}").status_code == 403

    # 管理员删除已取消单 → 明细一并移除，详情 404
    assert client.delete(f"/api/v1/requisitions/{req_id}").json()["code"] == 0
    d = client.get(f"/api/v1/requisitions/{req_id}")
    assert d.status_code == 404 and d.json()["code"] == 4003
    # 再次删除 → 不存在
    assert client.delete(f"/api/v1/requisitions/{req_id}").json()["code"] == 4003


def test_requisition_cancel_zero_after_stock():
    """回归：库存行恰为 -qty（测试导入的无入库直接出库数据）时取消回补落在 after=0，
    不得触发移动加权成本除零（此前 500），应正常取消并归零。"""
    _login_admin()
    wh_id, loc_id, pid = _setup_stock("10")
    c = _login_tester()
    r = c.post("/api/v1/requisitions", json={
        "warehouse_id": wh_id, "use_location": "零点车间", "use_reason": "除零回归",
        "items": [{"product_id": pid, "qty": "10", "location_id": loc_id}],
    })
    assert r.json()["code"] == 0, r.text
    req_id = r.json()["data"]["id"]

    # 直接把库存行改成 -qty，复现导入数据的坏状态（正常流程到不了这里）
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models.stock import StkStock

    db = SessionLocal()
    try:
        s = db.scalar(select(StkStock).where(
            StkStock.product_id == pid,
            StkStock.warehouse_id == wh_id,
            StkStock.location_id == loc_id,
        ))
        assert s is not None
        s.qty = -10
        db.commit()
    finally:
        db.close()

    # 取消回补：-10 + 10 = 0，不再除零
    assert client.post(f"/api/v1/requisitions/{req_id}/cancel").json()["code"] == 0
    assert client.get(f"/api/v1/requisitions/{req_id}").json()["data"]["status"] == 5
    assert _stock_qty(pid) == "0.000"
