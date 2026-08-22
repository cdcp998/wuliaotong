"""查询 sys_notification 现状：按用户/类型/标题统计 + 列出最近 60 条，排查“信息残留”。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select, text

from app.db import SessionLocal

db = SessionLocal()
try:
    print("=== 总量 ===")
    total = db.execute(text("SELECT COUNT(*) FROM sys_notification")).scalar()
    print("sys_notification 总行数:", total)

    print("\n=== 按 biz_type 统计 ===")
    rows = db.execute(
        text(
            "SELECT biz_type, COUNT(*) AS cnt, SUM(is_read=0) AS unread "
            "FROM sys_notification GROUP BY biz_type ORDER BY cnt DESC"
        )
    ).all()
    for r in rows:
        print(f"  {r.biz_type or '(空)':<8} 总数={r.cnt:<6} 未读={r.unread}")

    print("\n=== 按 标题 统计 ===")
    rows = db.execute(
        text(
            "SELECT title, COUNT(*) AS cnt, SUM(is_read=0) AS unread "
            "FROM sys_notification GROUP BY title ORDER BY cnt DESC LIMIT 40"
        )
    ).all()
    for r in rows:
        print(f"  [{r.cnt:>3} 条 / 未读 {r.unread}] {r.title}")

    print("\n=== 最近 60 条（含用户）===")
    rows = db.execute(
        text(
            "SELECT n.id, u.username, n.biz_type, n.title, n.is_read, n.created_at "
            "FROM sys_notification n LEFT JOIN sys_user u ON u.id=n.user_id "
            "ORDER BY n.id DESC LIMIT 60"
        )
    ).all()
    for r in rows:
        print(f"  #{r.id:<6} {r.username or '?' :<20} {r.biz_type or '-':<4} 已读={r.is_read} {r.created_at} {r.title}")

    print("\n=== 已处理但仍残留的“待办/审批”类（按是否与业务状态对得上，先人工核对）===")
    rows = db.execute(
        text(
            "SELECT n.id, u.username, n.biz_type, n.title, n.created_at "
            "FROM sys_notification n LEFT JOIN sys_user u ON u.id=n.user_id "
            "WHERE n.biz_type IN ('待办','审批') ORDER BY n.id DESC LIMIT 30"
        )
    ).all()
    for r in rows:
        print(f"  #{r.id:<6} {r.username or '?' :<20} {r.biz_type:<4} {r.created_at} {r.title}")
finally:
    db.close()
