"""cable 模块（线缆管理）：线缆/标记点/故障/卫星地图/瓦片代理/测距导航。

模块契约（方案 §2.2）：源码位于 backend/modules/cable/，由 build_modules.py 复制到
backend/app/modules/cable/ 供运行时加载；生命周期由管理界面触发（安装/启停/升级/卸载）。
"""
from __future__ import annotations

__version__ = "1.0.0"

from app.core.modules import ModuleDef
from app.modules.cable.api import router
from app.modules.cable.services.download_worker import download_worker_tick

# 生命周期钩子（幂等、可重入；本模块当前无额外初始化，均留空）
# on_install / on_enable / on_disable / on_uninstall 可在此按需定义

module = ModuleDef(
    code="cable",
    name="线缆管理",
    version=__version__,
    router=router,
    dependencies=[],
    audit_labels={
        "cables": "线缆",
        "faults": "故障",
        "geo": "定位",
        "map": "地图",
    },
    install_sql=["sql/install.sql"],
    jobs=[download_worker_tick],  # 瓦片批量下载（tick 校验 ENABLED）
)
