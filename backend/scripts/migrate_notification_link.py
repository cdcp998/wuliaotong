"""迁移：sys_notification 增加 link 字段（业务联动跳转目标，兼作自动已读唯一键）。
幂等：已存在该列则跳过。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.db import SessionLocal

db = SessionLocal()
try:
    cols = {row[0] for row in db.execute(text("SHOW COLUMNS FROM sys_notification")).all()}
    if "link" in cols:
        print("sys_notification.link 已存在，跳过")
    else:
        db.execute(
            text(
                "ALTER TABLE sys_notification "
                "ADD COLUMN link VARCHAR(255) NOT NULL DEFAULT '' COMMENT '业务联动跳转目标' AFTER biz_type, "
                "ADD KEY idx_link (link)"
            )
        )
        db.commit()
        print("已添加 sys_notification.link + idx_link")
finally:
    db.close()
