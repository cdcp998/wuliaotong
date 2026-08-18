"""数据库备份服务：mysqldump → gzip → sys_backup_log（API 手动与 scheduler 每日自动共用）。"""
from __future__ import annotations

import gzip
import logging
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.config import settings
from app.core.response import BizError, E_FILE_FAILED
from app.models.sys import SysBackupLog

logger = logging.getLogger("app.backup")

# 自动备份保留份数（更早的自动备份自动清理；手动备份不清理）
AUTO_KEEP = 14


def _db_params() -> dict:
    """从 DB_URL 解析 mysqldump 连接参数。"""
    u = urlparse(settings.db_url.replace("mysql+pymysql://", "mysql://"))
    return {
        "host": u.hostname or "127.0.0.1",
        "port": str(u.port or 3306),
        "user": u.username or "root",
        "password": u.password or "",
        "db": (u.path or "/").lstrip("/"),
    }


def backup_dir() -> Path:
    d = Path(settings.backup_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def run_backup(db: Session, backup_type: str = "manual") -> SysBackupLog:
    """执行 mysqldump 备份并落库。失败抛 BizError(E_FILE_FAILED)。"""
    p = _db_params()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    sql_path = backup_dir() / f"{p['db']}_{ts}.sql"
    cmd = [
        settings.backup_mysqldump,
        "-h", p["host"], "-P", p["port"], "-u", p["user"],
        "--single-transaction", "--default-character-set=utf8mb4",
        "--routines", "--triggers", p["db"],
    ]
    # 密码走 MYSQL_PWD 环境变量，避免出现在命令行/进程列表
    with open(sql_path, "wb") as sql_file:
        proc = subprocess.run(
            cmd,
            env=dict(os.environ, MYSQL_PWD=p["password"]),
            stdout=sql_file,
            stderr=subprocess.PIPE,
            timeout=600,
        )
    if proc.returncode != 0:
        sql_path.unlink(missing_ok=True)
        err = proc.stderr.decode("utf-8", "ignore")[:300]
        logger.error("数据库备份失败：%s", err)
        raise BizError(E_FILE_FAILED, "备份失败，请检查 BACKUP_MYSQLDUMP 路径（详情见系统日志）")

    gz_path = backup_dir() / f"{p['db']}_{ts}.sql.gz"
    with open(sql_path, "rb") as fin, gzip.open(gz_path, "wb") as fout:
        shutil.copyfileobj(fin, fout)
    sql_path.unlink(missing_ok=True)

    log = SysBackupLog(
        file_path=gz_path.name,
        file_size=gz_path.stat().st_size,
        backup_type=backup_type,
        status=1,
    )
    db.add(log)
    db.commit()
    return log


def cleanup_auto_backups(db: Session) -> int:
    """清理超出保留份数的自动备份，返回删除份数。"""
    rows = db.query(SysBackupLog).filter(SysBackupLog.backup_type == "auto").order_by(SysBackupLog.id.desc()).all()
    removed = 0
    for old in rows[AUTO_KEEP:]:
        try:
            (backup_dir() / old.file_path).unlink(missing_ok=True)
        except OSError:
            pass
        db.delete(old)
        removed += 1
    if removed:
        db.commit()
    return removed
