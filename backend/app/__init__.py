"""物料通管理系统 后端应用。

版本号是全仓唯一的后端事实源（见《开发规范.md》§版本管理）：
- /api/v1/health 的 version 字段自动读取本值
- backend/app/main.py 的 FastAPI version 也读取本值（version=__version__，无硬编码）
- 前端 4 个 package.json 的 version 必须与本值一致（UI 经 Vite 构建注入 __APP_VERSION__ 展示）
- 一致性由 scripts/check_version.py 强制校验（scripts/run_tests.sh 前置门禁）
- 每次升级必须同步所有位置并打 tag v<版本号>
"""

__version__ = "0.1.0"
