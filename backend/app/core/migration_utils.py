"""模块迁移工具函数（线缆和设备插件方案 §2.2 / §13.1.3）。

约定：
- 所有模块 migration 必须使用本文件工具函数保证幂等（MySQL 8 不支持 ADD COLUMN IF NOT EXISTS）。
- install.sql 作为 baseline 只执行一次（版本号固定 'baseline'，纳入 checksum）。
- 增量 migration 文件只含一条 DDL，或由模块在 ModuleDef.migration_executors 提供 Python 执行函数
  （函数内部先调用 table_exists/column_exists/index_exists 判断再执行）。
"""
from __future__ import annotations

import logging

import pymysql
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger("app.migration_utils")


def table_exists(db: Session, table: str) -> bool:
    """判断表是否存在（information_schema，尊重当前库）。"""
    return bool(
        db.scalar(
            text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name = :t"
            ),
            {"t": table},
        )
    )


def column_exists(db: Session, table: str, column: str) -> bool:
    """判断表中是否存在某列。"""
    return bool(
        db.scalar(
            text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
            ),
            {"t": table, "c": column},
        )
    )


def index_exists(db: Session, table: str, index: str) -> bool:
    """判断表中是否存在某索引。"""
    return bool(
        db.scalar(
            text(
                "SELECT COUNT(*) FROM information_schema.statistics "
                "WHERE table_schema = DATABASE() AND table_name = :t AND index_name = :i"
            ),
            {"t": table, "i": index},
        )
    )


def execute_sql_script(script: str) -> None:
    """在独立连接上执行多语句 SQL 脚本（模块 install.sql 基线专用）。

    使用 PyMySQL + CLIENT.MULTI_STATEMENTS 交给 MySQL 服务端分句（正确识别注释与字符串内分号），
    单连接单事务提交；任一语句失败回滚并抛异常（幂等设计兜底，见方案 §2.2 失败恢复策略）。
    """
    url = make_url(settings.db_url)
    conn = pymysql.connect(
        host=url.host or "127.0.0.1",
        port=url.port or 3306,
        user=url.username or "root",
        password=url.password or "",
        database=url.database or "",
        charset="utf8mb4",
        client_flag=pymysql.constants.CLIENT.MULTI_STATEMENTS,
        autocommit=False,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(script)
            while cur.nextset():  # 消费全部结果集，避免「Commands out of sync」
                pass
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def execute_sql_statement(db: Session, sql: str) -> None:
    """执行单条 DDL/DML（增量 migration 文件约定：一个文件一条语句）。"""
    db.execute(text(sql))
    db.commit()
