"""开发库迁移：base_location 增加 row_no/col_no（层×行×列=隔，幂等）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402

with engine.begin() as conn:
    cols = {r[0] for r in conn.execute(text("SHOW COLUMNS FROM base_location")).fetchall()}
    if "row_no" not in cols:
        conn.execute(text(
            "ALTER TABLE base_location ADD COLUMN row_no INT NOT NULL DEFAULT 1 "
            "COMMENT '行号' AFTER layer_no"
        ))
    if "col_no" not in cols:
        conn.execute(text(
            "ALTER TABLE base_location ADD COLUMN col_no INT NOT NULL DEFAULT 1 "
            "COMMENT '列号' AFTER row_no"
        ))
print("base_location row/col ready")
