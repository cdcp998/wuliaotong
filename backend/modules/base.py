"""模块开发契约（开发期引用；运行时以 app.core.modules.ModuleDef 为准）。

模块包结构（线缆和设备插件方案 §2.2）：
  modules/{code}/
  ├─ __init__.py          # __version__ + module = ModuleDef(...)
  ├─ api.py               # router（router 级 require_module_enabled(code)）
  ├─ models.py            # SQLAlchemy 模型（表由自带 sql/install.sql 创建）
  ├─ schemas.py           # Pydantic
  ├─ sql/install.sql      # 基线建表+种子（幂等，纳入 checksum）
  ├─ sql/migrations/      # 0001_xxx.sql（增量，禁止修改已发布）
  └─ services/            # 业务服务

约定：
- 卸载绝不 DROP TABLE（数据红线）；安装/迁移必须幂等（migration_utils 工具函数）。
- 模块间禁止跨模块 import models；跨模块数据访问走 API 或共享 core 层。
"""
