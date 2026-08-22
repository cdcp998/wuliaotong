"""冒烟：link 字段 ORM 往返 + 自动已读 SQL 逻辑 + 清理后数据概况。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text

from app.db import SessionLocal
from app.models.sys import SysNotification

db = SessionLocal()
try:
    # 1) ORM 往返：带 link 写入
    n = SysNotification(user_id=1, title="冒烟-待办", content="测试", biz_type="待办", link="/requisitions/12345")
    db.add(n)
    db.flush()
    got = db.get(SysNotification, n.id)
    print("ORM link 往返:", got.link, got.biz_type)
    # 2) 自动已读 SQL（模拟 _clear_requisition_todo）
    from sqlalchemy import update
    db.execute(
        update(SysNotification)
        .where(SysNotification.link == "/requisitions/12345", SysNotification.title == "冒烟-待办", SysNotification.is_read == 0)
        .values(is_read=1)
    )
    db.commit()
    print("自动已读后 is_read:", db.get(SysNotification, n.id).is_read)
    # 清理冒烟数据
    db.execute(text("DELETE FROM sys_notification WHERE id = :id"), {"id": n.id})
    db.commit()
    # 3) 概况
    rows = db.execute(
        text("SELECT biz_type, COUNT(*) c, SUM(is_read=0) unread FROM sys_notification GROUP BY biz_type ORDER BY c DESC")
    ).all()
    for r in rows:
        print(f"  {r.biz_type or '(空)':<6} 总数={r.c:<5} 未读={r.unread}")
    total = db.execute(text("SELECT COUNT(*) FROM sys_notification")).scalar()
    print("总条数:", total)
finally:
    db.close()
