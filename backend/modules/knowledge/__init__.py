"""knowledge 模块（知识库）：知识条目/版本/审核发布/AI 生成（草稿待审）/物料关联。

模块契约（方案 §2.2）：源码位于 backend/modules/knowledge/，由 build_modules.py 部署；
后台 AI 生成 worker 经 ModuleDef.jobs 注册（scheduler tick 校验 ENABLED，方案 §5.7）。
"""
from __future__ import annotations

__version__ = "1.0.0"

from app.core.modules import ModuleDef
from app.modules.knowledge.api import router
from app.modules.knowledge.services.ai_generate import knowledge_worker_tick

module = ModuleDef(
    code="knowledge",
    name="知识库",
    version=__version__,
    router=router,
    dependencies=[],
    audit_labels={
        "knowledge": "知识库",
    },
    install_sql=["sql/install.sql"],
    jobs=[knowledge_worker_tick],
)
