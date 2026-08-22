"""模块 MigrationRunner（幂等可重入，线缆和设备插件方案 §2.2 / §13.1.3）。

约定：
- install.sql 作为 baseline（version='baseline'）纳入 sys_module_migration 并计算 checksum。
- 增量 migration 从 0001 起只含增量；文件名前缀为数字序号（如 0001_initial.sql）。
- 已执行且 checksum 一致 → 跳过；不一致 → 拒绝升级（禁止修改已发布 migration / install.sql）。
- 每个 migration 文件只含一条 DDL，或由 ModuleDef.migration_executors 提供 Python 函数
  （函数用 app.core.migration_utils 工具函数保证幂等）。
- 失败恢复：失败记录 success=0 + 模块置 ERROR；修复 = 追加幂等新 migration（推荐）。
"""
from __future__ import annotations

import hashlib
import importlib.util
import logging
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.migration_utils import execute_sql_script, execute_sql_statement
from app.models.sys import SysModule, SysModuleMigration

logger = logging.getLogger("app.migration_runner")

BASELINE_VERSION = "baseline"


class ModuleMigrationError(Exception):
    """模块迁移失败（调用方负责记 last_error + state=ERROR）。"""


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def module_runtime_dir(code: str) -> Path:
    """运行时模块目录（app/modules/{code}，build_modules.py 管线产物）。"""
    spec = importlib.util.find_spec(f"app.modules.{code}")
    if not spec or not spec.submodule_search_locations:
        raise ModuleMigrationError(f"模块 {code} 源码未部署（app/modules/{code} 不存在）")
    return Path(list(spec.submodule_search_locations)[0])


class MigrationRunner:
    """模块 SQL 版本管理器（独立类便于测试）。"""

    def __init__(self, db: Session, code: str) -> None:
        self.db = db
        self.code = code
        self.base_dir = module_runtime_dir(code)

    # ---------- baseline（install.sql） ----------

    def _baseline_records(self) -> list[SysModuleMigration]:
        return list(
            self.db.scalars(
                select(SysModuleMigration).where(
                    SysModuleMigration.module_code == self.code,
                    SysModuleMigration.version == BASELINE_VERSION,
                )
            ).all()
        )

    def _run_baseline(self, install_files: list[str]) -> None:
        """执行 install.sql 并记录 baseline（幂等：未记录才执行；已记录校验 checksum）。"""
        if not install_files:
            return
        combined = []
        for rel in install_files:
            path = self.base_dir / rel
            if not path.exists():
                raise ModuleMigrationError(f"install 脚本缺失：{rel}")
            combined.append(path.read_text(encoding="utf-8"))
        script = "\n".join(combined)
        digest = _sha256(script)

        records = self._baseline_records()
        if records:
            if records[0].checksum != digest:
                raise ModuleMigrationError(
                    "install.sql 与已执行基线 checksum 不一致（禁止修改已发布基线）："
                    f"已执行 {records[0].checksum[:12]}… ≠ 当前 {digest[:12]}…"
                )
            if records[0].success:
                return  # 幂等：已成功执行过
            raise ModuleMigrationError("install.sql 上次执行失败，请修复后重试（或重写幂等基线）")
        logger.info("模块 %s 执行安装基线（%s）", self.code, ", ".join(install_files))
        try:
            execute_sql_script(script)
        except Exception as exc:
            self.db.add(
                SysModuleMigration(
                    module_code=self.code, version=BASELINE_VERSION,
                    checksum=digest, success=0,
                )
            )
            self.db.commit()
            raise ModuleMigrationError(f"install.sql 执行失败：{exc}") from exc
        self.db.add(
            SysModuleMigration(
                module_code=self.code, version=BASELINE_VERSION,
                checksum=digest, success=1,
            )
        )
        self.db.commit()

    # ---------- 增量 migrations ----------

    def _migration_files(self) -> list[tuple[int, str]]:
        """返回 [(序号, 文件名)]，按序号升序；忽略非 .sql 与无序号前缀文件。"""
        mig_dir = self.base_dir / self._migrations_dir()
        if not mig_dir.exists():
            return []
        out = []
        for f in sorted(mig_dir.iterdir()):
            m = re.match(r"^(\d+)_", f.name)
            if f.is_file() and f.suffix == ".sql" and m:
                out.append((int(m.group(1)), f.name))
        return out

    def _migrations_dir(self) -> str:
        # ModuleDef.migrations_dir 由调用方传入（runner 不持有 def，读到 def 由 caller 传）
        return self._mig_dir

    def _set_migrations_dir(self, value: str) -> None:
        self._mig_dir = value

    def run(self, module) -> int:
        """执行迁移：返回本次应用数量（0 = 无新迁移，幂等）。

        module：ModuleDef（提供 install_sql / migrations_dir / migration_executors）。
        """
        self._set_migrations_dir(module.migrations_dir)
        row = self.db.scalar(select(SysModule).where(SysModule.code == self.code))
        if row is None:
            raise ModuleMigrationError(f"模块 {self.code} 未登记")

        self._run_baseline(module.install_sql)

        current = 0
        try:
            current = int(row.schema_version or "0")
        except ValueError:
            current = 0
        applied = 0
        for seq, filename in self._migration_files():
            if seq <= current:
                continue
            content = (self.base_dir / self._migrations_dir() / filename).read_text(encoding="utf-8")
            digest = _sha256(content)
            rec = self.db.scalar(
                select(SysModuleMigration).where(
                    SysModuleMigration.module_code == self.code,
                    SysModuleMigration.version == filename,
                )
            )
            if rec is not None:
                if rec.checksum != digest:
                    raise ModuleMigrationError(
                        f"migration {filename} checksum 不一致（禁止修改已发布迁移）："
                        f"已执行 {rec.checksum[:12]}… ≠ 当前 {digest[:12]}…"
                    )
                if rec.success:
                    continue  # 已成功应用
                raise ModuleMigrationError(f"migration {filename} 上次执行失败，请修复后重试")
            logger.info("模块 %s 应用迁移 %s", self.code, filename)
            try:
                executor = module.migration_executors.get(filename)
                if executor is not None:
                    executor(self.db)
                    self.db.commit()
                else:
                    execute_sql_statement(self.db, content)
            except Exception as exc:
                self.db.add(
                    SysModuleMigration(
                        module_code=self.code, version=filename, checksum=digest, success=0,
                    )
                )
                self.db.commit()
                raise ModuleMigrationError(f"migration {filename} 执行失败：{exc}") from exc
            self.db.add(
                SysModuleMigration(
                    module_code=self.code, version=filename, checksum=digest, success=1,
                )
            )
            self.db.commit()
            current = seq
            applied += 1
        if applied:
            row.schema_version = str(current)
            self.db.commit()
        return applied
