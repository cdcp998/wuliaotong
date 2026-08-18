"""一次性迁移：pch_purchase_in 增加 ocr_bill_no（送货单号）列。

幂等：列已存在时跳过。用法：backend 目录下 .venv\\Scripts\\python.exe scripts\\alter_add_ocr_bill_no.py
"""
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()


def main() -> None:
    url = os.environ["DB_URL"]
    engine = create_engine(url)
    with engine.begin() as conn:
        cols = [r[0] for r in conn.execute(text("SHOW COLUMNS FROM pch_purchase_in"))]
        if "ocr_bill_no" in cols:
            print("ocr_bill_no 已存在，跳过")
            return
        conn.execute(text(
            "ALTER TABLE pch_purchase_in "
            "ADD COLUMN ocr_bill_no VARCHAR(60) NOT NULL DEFAULT '' "
            "COMMENT '送货单号（OCR 识别/手工填写，可空）' AFTER ocr_record_id"
        ))
        print("ALTER TABLE pch_purchase_in ADD ocr_bill_no 完成")


if __name__ == "__main__":
    main()
