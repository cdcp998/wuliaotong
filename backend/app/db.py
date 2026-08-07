"""SQLAlchemy engine / session / Base。"""
from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(
    settings.db_url,
    pool_pre_ping=True,
    pool_recycle=3600,
    pool_size=10,
    max_overflow=20,
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """ORM 模型基类（表结构以 sql/init.sql 为准，模型仅映射，不自动建表）。"""


def reconfigure_db(db_url: str) -> None:
    """运行时切换全局数据库连接（初始化安装完成后热生效，无需重启后端）。

    先创建新引擎并验证连通（SELECT 1），成功才替换全局 engine/SessionLocal，
    旧连接池 dispose 释放；失败抛异常（调用方回退提示重启后端）。
    注意：仅对当前进程生效，多 worker/多进程部署需重启全部进程。
    """
    new_engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_recycle=3600,
        pool_size=10,
        max_overflow=20,
        echo=False,
    )
    with new_engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    global engine, SessionLocal
    old = engine
    engine = new_engine
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        old.dispose()
    except Exception:  # noqa: BLE001 旧连接池释放失败不影响新连接
        pass


def get_db():
    """FastAPI 依赖：请求级数据库会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
