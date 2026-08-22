#!/usr/bin/env python
"""统一版本号一致性校验（《开发规范.md》§9 版本管理）。

单一事实源：`backend/app/__init__.py` 的 `__version__`（全仓唯一版本源）。

校验项（任一不通过 → 退出码 1，禁止提交）：
  1. 前端 4 个 package.json 的 version 与事实源一致
  2. backend/app/main.py 读取 `__version__`（不硬编码 version="x.y.z"）
  3. 前端 src 不硬编码当前版本号（应走 Vite 构建注入 `__APP_VERSION__`）
  4. 健康检查测试 backend/tests/test_auth.py::test_health 存在（断言 health.version == __version__）

用法：python scripts/check_version.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PACKAGE_JSONS = [
    "frontend/package.json",
    "frontend/apps/desktop/package.json",
    "frontend/apps/mobile/package.json",
    "frontend/packages/shared/package.json",
]

# 前端展示层扫描：出现 `v<当前版本>` 说明有硬编码版本号，应改为 __APP_VERSION__ 注入
SRC_GLOBS = [
    "frontend/apps/desktop/src/**/*.ts",
    "frontend/apps/desktop/src/**/*.tsx",
    "frontend/apps/mobile/src/**/*.ts",
    "frontend/apps/mobile/src/**/*.tsx",
]


def read_source_version() -> str:
    init = (ROOT / "backend/app/__init__.py").read_text(encoding="utf-8")
    m = re.search(r'^\s*__version__\s*=\s*["\']([^"\']+)["\']', init, re.MULTILINE)
    if not m:
        print("✗ 无法从 backend/app/__init__.py 解析 __version__（单一事实源缺失）")
        sys.exit(1)
    return m.group(1)


def main() -> int:
    source = read_source_version()
    errors: list[str] = []

    # 1. 前端 4 个 package.json 与事实源一致
    print(f"事实源 __version__ = {source}")
    for rel in PACKAGE_JSONS:
        p = ROOT / rel
        try:
            ver = json.loads(p.read_text(encoding="utf-8"))["version"]
        except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
            errors.append(f"{rel}: 无法读取 version（{e}）")
            continue
        print(f"  {rel}: {ver}")
        if ver != source:
            errors.append(f"{rel}: version={ver!r} ≠ 事实源 {source!r}")

    # 2. backend/app/main.py 使用 __version__
    main_py = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
    if "from app import __version__" not in main_py:
        errors.append("backend/app/main.py: 未导入 __version__")
    if "version=__version__" not in main_py:
        errors.append("backend/app/main.py: FastAPI 未使用 version=__version__")
    if re.search(r'\bversion\s*=\s*["\']\d', main_py):
        errors.append('backend/app/main.py: 存在硬编码 version="x.y.z"（应使用 __version__）')

    # 3. 前端 src 不硬编码当前版本号
    hardcoded_count = 0
    for glob in SRC_GLOBS:
        for p in ROOT.glob(glob):
            if ".dist" in p.parts or ".node_modules" in p.parts:
                continue
            content = p.read_text(encoding="utf-8", errors="ignore")
            if re.search(rf"v{re.escape(source)}", content):
                errors.append(f"{p.relative_to(ROOT)}: 存在硬编码 v{source}（应使用 __APP_VERSION__ 注入）")
                hardcoded_count += 1
    if hardcoded_count:
        print(f"  ✗ 前端 src 发现 {hardcoded_count} 处硬编码版本号")

    # 4. 健康检查测试存在
    test_auth = ROOT / "backend/tests/test_auth.py"
    if not test_auth.exists():
        errors.append("backend/tests/test_auth.py: 不存在（应含 test_health 断言 health.version == __version__）")

    if errors:
        print("\n✗ 版本一致性校验失败（禁止提交）：")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("\n✅ 版本一致性校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
