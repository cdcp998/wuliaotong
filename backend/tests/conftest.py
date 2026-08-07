"""tests 包级配置：每个测试模块结束后自动清理测试产生的业务数据（B 类零残留）。

清理器 `_data_cleanup.cleanup_test_data()` 按可归因模式（测试命名/编码/关联）删除
测试创建的商品、仓库、供应商、单据、库存、用户、角色、部门等；保留 admin/tester_user、
种子数据（角色/权限/单位/默认分类）、本地默认存储、无法精确归因的日志类数据
（操作日志/LLM 日志/预警通知/OCR 历史记录）。
"""
from __future__ import annotations

import pytest


@pytest.fixture(scope="module", autouse=True)
def _auto_cleanup_test_data():
    """模块级 autouse：模块内全部测试结束后执行清理（含历史残留，自动收敛）。"""
    yield
    from _data_cleanup import cleanup_test_data

    cleanup_test_data()
