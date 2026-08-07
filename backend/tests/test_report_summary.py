"""报表月报摘要测试（P9-P1⑦ 本地规则版，L2 门禁）：规则拼接含关键数字与建议，不调大模型。"""
from datetime import date

from app.db import SessionLocal
from app.services.ai import report_summary


def test_report_summary_rule_based():
    with SessionLocal() as db:
        r = report_summary.report_summary(db, date(2026, 7, 1), date(2026, 8, 7))
    assert r["ai"] is False
    assert "入库" in r["summary"] and "出库" in r["summary"] and "采购金额" in r["summary"]
    assert "2026-07-01 至 2026-08-07" in r["summary"]
    # 测试库存在历史出入库数据，摘要应包含具体数字
    assert any(ch.isdigit() for ch in r["summary"])
