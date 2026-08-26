"""tests 包级配置：每个测试模块结束后自动清理测试产生的业务数据（B 类零残留）。

清理器 `_data_cleanup.cleanup_test_data()` 按可归因模式（测试命名/编码/关联）删除
测试创建的商品、仓库、供应商、单据、库存、用户、角色、部门等；保留 admin/tester_user、
种子数据（角色/权限/单位/默认分类）、本地默认存储、无法精确归因的日志类数据
（操作日志/LLM 日志/预警通知/OCR 历史记录）。

另含会话级「零残留校验守卫」（评审 P2-7）：仅在设置 TEST_DB_URL 隔离模式时启用，
测试结束后对业务表做「行数对比」断言——任何净增即失败，杜绝测试垃圾残留未被清理器
覆盖（CI 中 TEST_DB_URL 已强制设置，等价于 CI 强制零残留）。
"""
from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="module", autouse=True)
def _auto_cleanup_test_data():
    """模块级 autouse：模块内全部测试结束后执行清理（含历史残留，自动收敛）。"""
    yield
    from _data_cleanup import cleanup_test_data

    cleanup_test_data()


# 零残留守卫监控的业务表：清理器保证清零的「测试会写入」表。
# 排除（无法精确归因或属种子/配置，见 _data_cleanup 说明）：
#   sys_session（登录会话）、sys_operation_log / sys_llm_log / sys_notification /
#   sys_file（日志/通知/biz_id=0 历史 OCR 原图）、sys_config / sys_menu / sys_permission /
#   sys_role_permission（模块 install 基线注入的角色授权，挂种子角色，属配置态——同 sys_menu/sys_permission）、
#   sys_storage / sys_backup_log / sys_delete_review / pch_purchase_plan*
_GUARD_TABLES = (
    "base_warehouse", "base_shelf", "base_location", "base_product", "base_product_unit",
    "base_product_supplier", "base_supplier", "base_category", "base_department",
    "base_department_shelf", "base_unit",
    "stk_stock", "stk_stock_log", "stk_opening", "stk_opening_item",
    "pch_purchase_in", "pch_purchase_in_item", "out_requisition", "out_requisition_item",
    "stk_other_io", "stk_other_io_item", "stk_transfer", "stk_transfer_item",
    "stk_check", "stk_check_item", "ocr_record", "ai_suggestion",
    "sys_user", "sys_role", "sys_register_apply",
)


@pytest.fixture(scope="session", autouse=True)
def _zero_residue_guard(ensure_admin_account):
    """会话级零残留校验：测试后数据库行数对比，任何业务表净增即失败。

    依赖 ensure_admin_account（admin/tester_user 基线用户创建之后才快照基线），
    使基线包含测试契约账号，避免误报。
    """
    if not os.getenv("TEST_DB_URL", ""):
        # 未隔离：测试直接跑在开发库上，不做行数断言（也无法安全清理兜底），仅沿用模块级清理
        yield
        return
    from sqlalchemy import func, select, text

    from app.db import SessionLocal

    def _counts() -> dict[str, int | None]:
        out: dict[str, int | None] = {}
        with SessionLocal() as db:
            for t in _GUARD_TABLES:
                try:
                    out[t] = db.scalar(select(func.count()).select_from(text(t)))
                except Exception:  # noqa: BLE001 表不存在/查询失败按不可比处理
                    out[t] = None
        return out

    baseline = _counts()
    yield
    # 全部测试结束后先兜底清理一次（模块级清理已执行过，此处幂等收敛历史残留），再对比
    from _data_cleanup import cleanup_test_data

    try:
        cleanup_test_data()
    except Exception as exc:  # noqa: BLE001 清理失败也要继续对比并暴露问题
        print(f"[zero_residue_guard] 兜底清理异常（继续对比）: {exc}")
    after = _counts()
    residue = {
        t: after[t] - baseline[t]
        for t in _GUARD_TABLES
        if baseline.get(t) is not None and after.get(t) is not None and after[t] > baseline[t]
    }
    if residue:
        raise RuntimeError(
            "测试数据零残留校验失败，以下业务表在测试后仍残留数据（行数净增）：\n  "
            + "\n  ".join(f"{t}: +{n}" for t, n in sorted(residue.items()))
            + "\n请检查对应测试的清理逻辑，或为 _data_cleanup 补充归因模式后再提交。"
        )
