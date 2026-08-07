"""物料通管理系统 后端应用。

版本号是全仓唯一的后端事实源（见《开发规范.md》§版本管理）：
- /api/v1/health 的 version 字段自动读取本值
- 前端 4 个 package.json 的 version 必须与本值一致
- 每次升级必须同步所有位置并打 tag v<版本号>
"""

__version__ = "0.1.0"
