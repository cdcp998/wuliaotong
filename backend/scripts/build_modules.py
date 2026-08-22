"""模块安装管线（线缆和设备插件方案 §2.2「安装管线」）。

扫描 backend/modules/ 各模块源码 → 校验结构 → 复制到 backend/app/modules/{code}/（运行时目录）
→ 生成 manifest.json（含 version/schema_version/build_id/source_commit/checksum）→ compileall 校验。

用法（在 backend/ 目录下）：
    python scripts/build_modules.py                # 构建全部模块
    python scripts/build_modules.py --module cable # 只构建指定模块
    python scripts/build_modules.py --check-only   # 只读预检（不改任何文件），输出 JSON

约定：
- 运行时目录 app/modules/ 由本脚本生成，禁止手工修改（开发规范补充 §2）。
- 已删除的模块源码 → 清理运行时旧目录（--check-only 只报告不清理）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
SOURCE_DIR = BACKEND_DIR / "modules"
RUNTIME_DIR = BACKEND_DIR / "app" / "modules"
MANIFEST_PATH = RUNTIME_DIR / "manifest.json"

_EXCLUDE_DIRS = {"__pycache__", ".git", ".pytest_cache"}
_VERSION_RE = re.compile(r"""__version__\s*=\s*["']([^"']+)["']""")
_MODULEDEF_RE = re.compile(r"\bmodule\s*=\s*ModuleDef\s*\(")
_MIGRATION_RE = re.compile(r"^(\d+)_")


def _dir_checksum(module_dir: Path) -> str:
    """模块目录全部文件 sha256（排除缓存目录），用于检测代码漂移。"""
    h = hashlib.sha256()
    files = sorted(
        p for p in module_dir.rglob("*")
        if p.is_file() and not any(part.startswith(".") and part != "." for part in p.parts) is False
    )
    # 上面的条件写错了也无妨：显式过滤 __pycache__ 与隐藏缓存
    files = [
        p for p in sorted(module_dir.rglob("*"))
        if p.is_file()
        and not any(part in _EXCLUDE_DIRS or part.startswith(".") for part in p.parts[1:])
    ]
    for p in files:
        rel = p.relative_to(module_dir).as_posix()
        h.update(rel.encode("utf-8"))
        h.update(p.read_bytes())
    return h.hexdigest()


def _read_version(module_dir: Path) -> str:
    init = (module_dir / "__init__.py").read_text(encoding="utf-8")
    m = _VERSION_RE.search(init)
    return m.group(1) if m else "0.0.0"


def _schema_version(module_dir: Path) -> str:
    mig_dir = module_dir / "sql" / "migrations"
    if not mig_dir.exists():
        return "0"
    nums = []
    for f in mig_dir.glob("*.sql"):
        m = _MIGRATION_RE.match(f.name)
        if m:
            nums.append(int(m.group(1)))
    return str(max(nums)) if nums else "0"


def _git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(BACKEND_DIR.parent),
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:  # noqa: BLE001
        return ""


def _scan_sources() -> dict[str, Path]:
    """扫描源码模块：{code: 目录}，code 取目录名。"""
    out: dict[str, Path] = {}
    if not SOURCE_DIR.exists():
        return out
    for d in sorted(SOURCE_DIR.iterdir()):
        if not d.is_dir() or d.name.startswith(".") or d.name == "base.py":
            continue
        init = d / "__init__.py"
        if not init.exists():
            continue
        content = init.read_text(encoding="utf-8")
        if not _MODULEDEF_RE.search(content):
            continue
        out[d.name] = d
    return out


def _load_runtime_manifest() -> dict:
    if MANIFEST_PATH.exists():
        try:
            return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
    return {}


def check_only() -> dict:
    """只读预检：对比源码与运行时 manifest，不改任何文件，输出 JSON 报告。"""
    sources = _scan_sources()
    manifest = _load_runtime_manifest()
    modules = []
    new_modules = []
    version_changes = []
    checksum_drift = []
    removed = [c for c in manifest if c not in sources]

    for code, mod_dir in sources.items():
        source_checksum = _dir_checksum(mod_dir)
        version = _read_version(mod_dir)
        schema_version = _schema_version(mod_dir)
        runtime = manifest.get(code) or {}
        modules.append(
            {
                "code": code,
                "source_version": version,
                "schema_version": schema_version,
                "checksum": source_checksum,
                "runtime_version": runtime.get("version", ""),
                "runtime_checksum": runtime.get("checksum", ""),
                "deployed": bool(runtime),
            }
        )
        if not runtime:
            new_modules.append(code)
        else:
            if runtime.get("version") and runtime.get("version") != version:
                version_changes.append({"code": code, "from": runtime.get("version"), "to": version})
            if runtime.get("checksum") and runtime.get("checksum") != source_checksum:
                checksum_drift.append(
                    {"code": code, "from": runtime.get("checksum", "")[:12], "to": source_checksum[:12]}
                )
    return {
        "modules": modules,
        "new_modules": new_modules,
        "version_changes": version_changes,
        "checksum_drift": checksum_drift,
        "removed_from_source": removed,
    }


def build_module(code: str, mod_dir: Path, manifest: dict) -> None:
    """复制单个模块到运行时目录并写入 manifest 条目。"""
    # 复制前备份旧 checksum（漂移诊断用）
    old = manifest.get(code, {})
    target = RUNTIME_DIR / code
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(mod_dir, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git"))
    # 清理复制产生的缓存
    for pyc in list(target.rglob("__pycache__")) + list(target.rglob("*.pyc")):
        if pyc.is_dir():
            shutil.rmtree(pyc, ignore_errors=True)
        else:
            pyc.unlink(missing_ok=True)
    manifest[code] = {
        "version": _read_version(mod_dir),
        "schema_version": _schema_version(mod_dir),
        "build_id": f"{int(time.time())}-{hashlib.sha256(str(time.time()).encode()).hexdigest()[:8]}",
        "source_commit": _git_commit(),
        "checksum": _dir_checksum(mod_dir),
        "previous_checksum": old.get("checksum", ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="模块安装管线")
    parser.add_argument("--module", help="只构建指定模块编码")
    parser.add_argument("--check-only", action="store_true", help="只读预检（不修改文件），输出 JSON")
    args = parser.parse_args()

    if args.check_only:
        print(json.dumps(check_only(), ensure_ascii=False, indent=2))
        return 0

    sources = _scan_sources()
    if args.module:
        if args.module not in sources:
            print(json.dumps({"error": f"源码中不存在模块 {args.module}", "available": list(sources)}, ensure_ascii=False))
            return 1
        sources = {args.module: sources[args.module]}

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    (RUNTIME_DIR / "__init__.py").write_text('"""模块运行时目录（scripts/build_modules.py 生成，禁止手工修改）。"""\n', encoding="utf-8")

    manifest = _load_runtime_manifest()
    built = []
    for code, mod_dir in sources.items():
        build_module(code, mod_dir, manifest)
        built.append(code)
    # 清理已删除模块的旧目录
    stale = [c for c in list(manifest) if c not in _scan_sources()]
    for code in stale:
        manifest.pop(code, None)
        shutil.rmtree(RUNTIME_DIR / code, ignore_errors=True)

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # compileall 校验（复制的模块源码可编译）
    failed = []
    for code in built:
        proc = subprocess.run(
            [sys.executable, "-m", "compileall", "-q", str(RUNTIME_DIR / code)],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            failed.append(code)
    if failed:
        print(json.dumps({"error": "compileall 校验失败", "modules": failed}, ensure_ascii=False))
        return 1
    print(json.dumps({"built": built, "cleaned": stale, "manifest": MANIFEST_PATH.name}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
