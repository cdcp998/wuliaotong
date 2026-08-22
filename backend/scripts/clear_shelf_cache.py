"""开发库缓存失效：仓库/货架/库位/货架图（新增字段后旧缓存结构过期）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from app.core.cache import cache_delete_pattern  # noqa: E402

for pattern in ("dict:warehouses", "dict:shelves*", "dict:locations*", "stock:locsum:*", "dict:departments"):
    cache_delete_pattern(pattern)
print("cache cleared")
