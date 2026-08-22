"""开发库迁移：采购计划单（pch_purchase_plan / pch_purchase_plan_item）+ 入库单新字段（幂等）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402

with engine.begin() as conn:
    cols = {r[0] for r in conn.execute(text("SHOW COLUMNS FROM pch_purchase_in")).fetchall()}
    if "plan_id" not in cols:
        conn.execute(text(
            "ALTER TABLE pch_purchase_in ADD COLUMN plan_id BIGINT NOT NULL DEFAULT 0 "
            "COMMENT '来源采购计划单' AFTER ocr_bill_no, ADD KEY idx_plan (plan_id)"
        ))
    if "delivery_file_ids" not in cols:
        conn.execute(text(
            "ALTER TABLE pch_purchase_in ADD COLUMN delivery_file_ids TEXT NULL "
            "COMMENT '送货单图片存底：JSON 数组' AFTER plan_id"
        ))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS pch_purchase_plan (
          id            BIGINT NOT NULL AUTO_INCREMENT,
          bill_no       VARCHAR(30)  NOT NULL,
          supplier_id   BIGINT       NOT NULL DEFAULT 0,
          warehouse_id  BIGINT       NOT NULL,
          total_qty     DECIMAL(12,3) NOT NULL DEFAULT 0,
          total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
          status        TINYINT      NOT NULL DEFAULT 0 COMMENT '0 草稿 / 1 已提交 / 2 部分入库 / 3 已完成 / -1 作废',
          plan_date     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          remark        VARCHAR(255) NOT NULL DEFAULT '',
          creator_id    BIGINT       NOT NULL DEFAULT 0,
          created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_bill_no (bill_no),
          KEY idx_supplier (supplier_id),
          KEY idx_status_time (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购计划单'
    """))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS pch_purchase_plan_item (
          id          BIGINT NOT NULL AUTO_INCREMENT,
          plan_id     BIGINT        NOT NULL,
          product_id  BIGINT        NOT NULL,
          planned_qty DECIMAL(12,3) NOT NULL,
          unit_name   VARCHAR(20)   NOT NULL DEFAULT '',
          est_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
          amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
          remark      VARCHAR(255)  NOT NULL DEFAULT '',
          sort        INT           NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_plan (plan_id),
          KEY idx_product (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购计划明细'
    """))
print("purchase plan tables/columns ready")
