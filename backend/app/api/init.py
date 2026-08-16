"""系统初始化安装接口（首次启动引导，《后端API设计.md》§1.1）。

初始化完成状态**仅以文件系统标记文件（backend/data/.initialized）是否存在判断**，
不依赖数据库状态——数据库重建/备份恢复不会导致强制重新进入初始化流程。
删除标记文件（并保留业务数据）即可重新进入初始化安装页。

- GET /init/status：未初始化时前端（电脑端入口/登录页/受保护路由，手机端登录页）强制跳转初始化安装页
- POST /init：仅未初始化时可执行（防重入）
  1. 自动验证数据库连接（pymysql 试连，失败 4006 阻止安装）与 Redis 连接（失败仅提示，缓存层降级直查）
  2. 写系统名称/联系电话 + 重置或创建内置超管账号（当前连接库）
  3. 数据库/Redis 配置写入 backend/.env（DB_URL/REDIS_URL，重启后端后生效；.env 已 gitignore）
  4. 事务提交成功后**原子写入标记文件**（临时文件 + os.replace，内容含完成时间），标记文件存在即代表初始化已可靠完成
"""
from __future__ import annotations

import ipaddress
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from dotenv import set_key
from fastapi import APIRouter, Depends, Request
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import BASE_DIR, settings
from app.core import cache as cache_mod
from app.core.deps import SUPER_ADMIN_ROLE_CODE
from app.core.response import BizError, E_FILE_FAILED, E_PARAM, ok
from app.core.security import hash_password
from app.db import get_db, reconfigure_db
from app.models.sys import SysConfig, SysRole, SysUser
from app.schemas.init import InitReq

logger = logging.getLogger("app.init")

router = APIRouter(prefix="/init", tags=["初始化安装"])

MARK_FILE = Path(settings.init_mark_file)
ENV_FILE = BASE_DIR / ".env"  # 安装配置写入目标（测试可 monkeypatch 指向临时文件）


def is_initialized() -> bool:
    """初始化状态：仅检查标记文件是否存在（不触发任何数据库查询）。"""
    return MARK_FILE.exists()


def _write_mark_file() -> None:
    """原子写入初始化完成标记文件：先写临时文件再 os.replace，避免半写/并发覆盖。

    内容含完成时间便于排障；文件仅作存在性标记，内容不影响判断。
    """
    MARK_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = MARK_FILE.with_name(f".{MARK_FILE.name}.tmp")
    tmp.write_text(f"initialized_at={datetime.now():%Y-%m-%d %H:%M:%S}\n", encoding="utf-8")
    os.replace(tmp, MARK_FILE)


def _pymysql_connect(host: str, port: int, user: str, password: str, database: str | None):
    """按统一超时参数连接 MySQL（database=None 为服务器级连接，用于建库）。"""
    import pymysql

    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        connect_timeout=5,
        read_timeout=5,
    )


def _try_connect(host: str, port: int, user: str, password: str, db_name: str | None) -> Exception | None:
    """试连 MySQL（含库名）；成功返回 None，失败返回异常对象（供 errno 识别与可读化）。"""
    try:
        conn = _pymysql_connect(host, port, user, password, db_name)
        conn.close()
        return None
    except Exception as exc:  # noqa: BLE001 连接失败需返回具体原因给用户
        logger.warning("数据库连接验证失败：%s", exc)
        return exc


def _errno_of(exc: Exception) -> int | None:
    """从 pymysql 异常文本提取 MySQL errno（形如 (1049, "...")）；非连接错误返回 None。"""
    m = re.match(r"^\((\d+),", str(exc))
    return int(m.group(1)) if m else None


def _friendly_db_error(exc: Exception | None) -> str:
    """把常见 MySQL 错误码映射为中文可读信息（其余保留原始信息）。"""
    if exc is None:
        return ""
    errno = _errno_of(exc)
    if errno == 1045:
        return "用户名或密码错误（Access denied），请核对数据库账号密码"
    if errno == 1044:
        return "当前数据库用户无权访问目标库，请检查授权"
    if errno in (2002, 2003):
        return "无法连接数据库服务器，请检查地址/端口是否正确、MySQL 服务是否已启动"
    return str(exc)


def _split_sql(text: str) -> list[str]:
    """把 init.sql 按分号拆成可逐条执行的语句（跳过注释行与空行）。"""
    stmts: list[str] = []
    buf: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("--"):
            continue
        buf.append(line)
        if line.endswith(";"):
            stmts.append(" ".join(buf))
            buf = []
    if buf:
        stmts.append(" ".join(buf))
    return stmts


def _db_has_tables(host: str, port: int, user: str, password: str, db_name: str) -> bool:
    """目标库是否已有表（存在部署数据的判据；空库可安全导入 init.sql）。"""
    conn = _pymysql_connect(host, port, user, password, db_name)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s",
                (db_name,),
            )
            return cur.fetchone()[0] > 0
    finally:
        conn.close()


def _ensure_db_schema(host: str, port: int, user: str, password: str, db_name: str) -> str | None:
    """建库（不存在时）+ 导入 backend/sql/init.sql（utf8mb4 建表+种子）。

    仅对全新库/空库调用——无数据可破坏；失败返回可读错误信息。
    库名已由 schema 限定 ^[A-Za-z0-9_]+$，此处仍做反引号转义双保险防标识符注入。
    """
    safe_name = db_name.replace("`", "``")
    try:
        conn = _pymysql_connect(host, port, user, password, None)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"CREATE DATABASE IF NOT EXISTS `{safe_name}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 建库失败需返回可读原因
        logger.warning("自动创建数据库失败：%s", exc)
        return (
            f"数据库「{db_name}」不存在且自动创建失败（{_friendly_db_error(exc)}），"
            f"请手动创建后重试：mysql -u{user} -p -e \"CREATE DATABASE {db_name} "
            "CHARACTER SET utf8mb4\""
        )
    sql_path = BASE_DIR / "sql" / "init.sql"
    if not sql_path.exists():
        return f"未找到建表脚本 {sql_path}，请检查安装包完整性"
    try:
        statements = _split_sql(sql_path.read_text(encoding="utf-8"))
        conn = _pymysql_connect(host, port, user, password, db_name)
        try:
            with conn.cursor() as cur:
                for stmt in statements:
                    cur.execute(stmt)
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 导入失败需返回可读原因
        logger.error("自动导入表结构失败：%s", exc)
        return (
            f"数据库已创建但表结构导入失败（{exc}），"
            f"请手动执行：mysql -u{user} -p {db_name} < backend/sql/init.sql"
        )
    return None


def _test_db_conn(host: str, port: int, user: str, password: str, db_name: str) -> str | None:
    """验证数据库连接（含库名）并保证表结构就绪。

    - 目标库不存在（1049）→ 自动建库并导入 init.sql（全新库，无数据可破坏）
    - 目标库存在但无任何表 → 自动导入 init.sql（空库无数据可破坏）
    - 目标库存在且有表 → 仅验证连接（已有部署数据，不动表结构）
    失败返回可读错误信息（常见错误码映射中文提示）。
    """
    err = _try_connect(host, port, user, password, db_name)
    if err is None:
        try:
            if not _db_has_tables(host, port, user, password, db_name):
                return _ensure_db_schema(host, port, user, password, db_name)
            return None
        except Exception as exc:  # noqa: BLE001 表检查失败需返回可读原因
            logger.warning("检查目标库表结构失败：%s", exc)
            return _friendly_db_error(exc)
    if _errno_of(err) != 1049:
        return _friendly_db_error(err)
    return _ensure_db_schema(host, port, user, password, db_name)


def _test_redis_conn(redis_host: str, redis_port: int, redis_password: str, redis_db: int) -> str | None:
    """试连 Redis（含密码认证）；成功返回 None，失败返回可读错误信息。"""
    try:
        r = Redis(
            host=redis_host,
            port=redis_port,
            password=redis_password or None,
            db=redis_db,
            protocol=2,  # 兼容 Redis 5.x（默认 RESP3 的 HELLO 命令 Redis6+ 才有，与 cache.py 一致）
            socket_connect_timeout=3,
            socket_timeout=3,
        )
        r.ping()
        r.close()
        return None
    except Exception as exc:  # noqa: BLE001 连接失败需返回具体原因给用户
        logger.warning("初始化 Redis 连接验证失败：%s", exc)
        return str(exc)


def _build_db_url(req: InitReq) -> str:
    """构造目标库 SQLAlchemy 连接串（密码 URL 编码）。"""
    return (
        f"mysql+pymysql://{quote(req.db_user, safe='')}:{quote(req.db_password, safe='')}"
        f"@{req.db_host}:{req.db_port}/{req.db_name}?charset=utf8mb4"
    )


def _build_redis_url(req: InitReq) -> str:
    """构造目标 Redis 连接串（密码 URL 编码；无密码不带认证段）。"""
    auth = f":{quote(req.redis_password, safe='')}@" if req.redis_password else ""
    return f"redis://{auth}{req.redis_host}:{req.redis_port}/{req.redis_db}"


def _write_env_config(req: InitReq) -> None:
    """把数据库/Redis 配置写入 .env（set_key：已有键替换、无则追加；密码做 URL 编码）。"""
    set_key(str(ENV_FILE), "DB_URL", _build_db_url(req))
    set_key(str(ENV_FILE), "REDIS_URL", _build_redis_url(req))


def _target_sessionmaker(req: InitReq):
    """为安装目标库创建独立会话工厂（连接验证阶段已保证目标库可用）。

    返回 (engine, sessionmaker)；调用方负责 finally 中 dispose engine。
    业务写入必须落在用户填写的目标库——绝不能使用启动时旧引擎连接的库，
    否则安装表单填写的库与后端实际使用的库不一致（曾导致数据写错库）。
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker as _sessionmaker

    target_engine = create_engine(
        _build_db_url(req),
        pool_pre_ping=True,
        pool_recycle=3600,
    )
    return target_engine, _sessionmaker(
        bind=target_engine, autoflush=False, autocommit=False, expire_on_commit=False
    )


def _apply_runtime_config(db_url: str, redis_url: str) -> None:
    """热切换进程内数据库/Redis 配置（无需重启后端；切换失败抛异常由调用方提示）。"""
    reconfigure_db(db_url)
    settings.db_url = db_url
    settings.redis_url = redis_url
    cache_mod.reset_client()  # 立即按新 Redis 配置重连；失败时按退避窗口自动重试（自治愈）


def _set_config(db: Session, key: str, value: str) -> None:
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    if cfg:
        cfg.config_value = value
    else:
        db.add(SysConfig(config_key=key, config_value=value, remark=""))


@router.get("/status")
def init_status(db: Session = Depends(get_db)) -> dict:
    """初始化状态（公开）：{initialized, site_name}。

    initialized 仅由标记文件存在性判断（不触发数据库查询）；数据库不可用时
    site_name 返回空串且不报错——保证数据库未就绪时安装页仍可正常打开。
    """
    site_name = ""
    try:
        site = db.scalar(select(SysConfig).where(SysConfig.config_key == "site.name"))
        site_name = site.config_value if site else ""
    except Exception as exc:  # noqa: BLE001 数据库不可用不阻塞安装页
        logger.warning("初始化状态读取站点名称失败（数据库不可用）：%s", exc)
    return ok(
        {
            "initialized": is_initialized(),
            "site_name": site_name,
        }
    )


def _is_private_ip(ip: str) -> bool:
    """判断来源 IP 是否为本机/私网地址；测试客户端（testclient）视为可信本地来源。"""
    if ip in ("testclient", "unknown"):
        return True
    try:
        return ipaddress.ip_address(ip).is_private or ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


@router.post("")
def do_init(req: InitReq, request: Request) -> dict:
    """执行初始化（公开，仅未初始化时可执行）：
    验证连接（缺失/空库自动建库导入）→ 目标库写系统信息 → 保存配置 → 热切换连接 → 写标记文件。

    安全限制：默认仅允许本机/私网来源执行安装（INIT_ALLOW_PUBLIC=true 才允许公网），
    避免首次启动期间安装接口暴露公网时被抢先接管系统。
    """
    if is_initialized():
        raise BizError(E_PARAM, "系统已完成初始化，不能重复执行")
    client_ip = request.client.host if request.client else "unknown"
    if not settings.init_allow_public and not _is_private_ip(client_ip):
        logger.warning("拒绝非私网来源执行初始化：ip=%s", client_ip)
        raise BizError(E_PARAM, "仅允许内网访问执行初始化安装，请通过内网/本机访问")

    # 连接验证：数据库必须可用（阻止安装）；Redis 失败仅提示（缓存层优雅降级）
    db_err = _test_db_conn(req.db_host, req.db_port, req.db_user, req.db_password, req.db_name)
    if db_err:
        raise BizError(E_PARAM, f"数据库连接失败：{db_err}")
    redis_err = _test_redis_conn(req.redis_host, req.redis_port, req.redis_password, req.redis_db)

    # 业务写入必须落在目标库（用户填写的库）：用独立会话，不使用启动时旧引擎，
    # 否则安装表单的库与后端实际使用的库不一致（历史上曾把账号写进旧库）
    target_engine, target_sm = _target_sessionmaker(req)
    try:
        with target_sm() as tdb:
            role = tdb.scalar(select(SysRole).where(SysRole.code == SUPER_ADMIN_ROLE_CODE))
            if role is None:
                raise BizError(E_PARAM, "系统角色数据缺失，无法完成初始化")
            admin = tdb.scalar(
                select(SysUser).where(SysUser.role_id == role.id).order_by(SysUser.id).limit(1)
            )
            # 防重置攻击：标记文件被误删后，任何人调用 /init 都会重写超管密码并接管系统。
            # 目标库存在 system.init_ts（首次初始化写入的时间戳，存量库由 upgrade_indexes.sql 补写）
            # 即视为已投入使用，拒绝重复初始化；重装需管理员手动清理该配置行（本地操作）。
            init_ts = tdb.scalar(select(SysConfig).where(SysConfig.config_key == "system.init_ts"))
            if init_ts is not None:
                raise BizError(E_PARAM, "目标库已完成初始化，禁止重复执行（如需重置密码请使用忘记密码或联系管理员）")
            # 改名冲突校验：目标账号已被其他用户占用（含大小写不敏感的唯一约束由 DB 兜底）
            conflict = tdb.scalar(
                select(SysUser).where(
                    SysUser.username == req.admin_username,
                    SysUser.id != (admin.id if admin else -1),
                )
            )
            if conflict is not None:
                raise BizError(E_PARAM, f"管理员账号「{req.admin_username}」已被占用，请更换")

            if admin:
                admin.username = req.admin_username
                admin.password_hash = hash_password(req.admin_password)
                admin.real_name = "超级管理员"
                admin.status = 1
            else:
                tdb.add(
                    SysUser(
                        username=req.admin_username,
                        password_hash=hash_password(req.admin_password),
                        real_name="超级管理员",
                        role_id=role.id,
                        status=1,
                    )
                )
            _set_config(tdb, "site.name", req.site_name)
            _set_config(tdb, "system.init_ts", datetime.now().isoformat())
            if req.contact_phone:
                _set_config(tdb, "site.contact_phone", req.contact_phone)
            tdb.commit()
    except BizError:
        raise
    except Exception as exc:  # noqa: BLE001 落库失败需返回可读原因
        logger.error("初始化业务数据写入目标库失败：%s", exc)
        raise BizError(E_PARAM, f"初始化数据写入目标库失败（{exc}）") from exc
    finally:
        target_engine.dispose()

    # 业务数据落库后再写 .env 与标记文件：标记文件存在 ⇔ 初始化数据已落库成功
    try:
        _write_env_config(req)
    except OSError as exc:
        logger.error("初始化配置写入 .env 失败：%s", exc)
        raise BizError(E_FILE_FAILED, f"数据库/Redis 配置写入 backend/.env 失败（{exc}），请检查目录写入权限后重试") from exc
    # 热切换进程内连接到目标库：当前进程立即生效，无需重启后端
    try:
        _apply_runtime_config(_build_db_url(req), _build_redis_url(req))
    except Exception as exc:  # noqa: BLE001 切换失败需给出可操作提示
        logger.error("初始化后数据库热切换失败：%s", exc)
        raise BizError(E_FILE_FAILED, f"配置已保存但数据库连接切换失败（{exc}），请重启后端后生效") from exc
    try:
        _write_mark_file()
    except OSError as exc:
        logger.error("初始化完成标记文件写入失败：%s", exc)
        raise BizError(E_FILE_FAILED, f"初始化完成标记写入失败（{exc}），请检查 {MARK_FILE.parent} 目录写入权限后重试") from exc
    logger.info("系统初始化完成：site_name=%s admin=%s redis_ok=%s", req.site_name, req.admin_username, redis_err is None)
    return ok({"redis_connected": redis_err is None, "redis_warning": redis_err})
