"""cable 模块（线缆管理）：线缆/标记点/故障/测距导航。

地图部分（图源配置/瓦片代理/缓存区域）已拆分到独立 map 模块——地图为基础设施，
本模块依赖 map（线缆/故障页面使用地图组件做选点与展示；启用顺序：map → task → cable）。
模块契约（方案 §2.2）：源码位于 backend/modules/cable/，由 build_modules.py 复制到
backend/app/modules/cable/ 供运行时加载；生命周期由管理界面触发（安装/启停/升级/卸载）。

v1.1 系统重构：**强依赖任务管理**（dependencies 增加 task>=1.3.0,<2.0.0）——故障的
维修派单统一走任务管理的任务池（fault_id 反向关联 MaintenanceTask），本模块不再有
独立派发体系。
"""
from __future__ import annotations

__version__ = "1.1.0"

from app.core.modules import ModuleDef
from app.modules.cable.api import router


module = ModuleDef(
    code="cable",
    name="线缆管理",
    version=__version__,
    router=router,
    dependencies=["map", "task>=1.3.0,<2.0.0"],
    audit_labels={
        "cables": "线缆",
        "faults": "线路故障",
        "geo": "定位",
    },
    audit_actions={
        ("POST", "/cables"): "新增线缆",
        ("PUT", "/cables/{id}"): "编辑线缆",
        ("PUT", "/cables/{id}/status"): "流转线缆状态",
        ("POST", "/cables/{id}/points"): "更新线缆路径节点",
        ("POST", "/cables/{id}/markers"): "新增线缆标记点",
        ("DELETE", "/cables/{id}/markers/{marker_id}"): "删除线缆标记点",
        ("POST", "/cables/import"): "批量导入线缆",
        ("POST", "/faults"): "故障上报",
        ("PUT", "/faults/{id}"): "编辑故障",
        ("PUT", "/faults/{id}/status"): "流转故障状态",
        ("POST", "/faults/{id}/photos"): "上传故障照片",
        ("DELETE", "/faults/{id}"): "删除故障",
    },
    install_sql=["sql/install.sql"],
)
