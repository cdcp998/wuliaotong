"""应用入口：lifespan、中间件（审计日志）、路由注册、异常处理。"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import auth as auth_api
from app.api import admin as admin_api
from app.api import advanced as advanced_api
from app.api import base_data as base_data_api
from app.api import files as files_api
from app.api import geo as geo_api
from app.api import init as init_api
from app.api import notification as notification_api
from app.api import ocr as ocr_api
from app.api import requisition as requisition_api
from app.api import report as report_api
from app.api import stock as stock_api
from app.api import storage as storage_api
from app.api import system as system_api
from app.config import settings
from app.core.deps import resolve_session_user
from app.core.logging_config import configure_logging, set_log_level
from app.core.loop_guard import install_loop_guard, install_proactor_accept_patch
from app.core.ratelimit import RateLimitMiddleware
from app.core.response import BizError, E_PARAM, biz_error_handler, err
from app.db import SessionLocal, engine
from app.models.sys import SysConfig, SysOperationLog
from app.scheduler import start_scheduler, stop_scheduler

logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动自检：数据库连通性（失败仅告警不阻止启动——数据库未就绪/未安装时仍可进入安装流程）；初始化运行时日志；启动定时任务。"""
    # Windows Proactor：客户端强制断开时 asyncio 回调抛 ConnectionResetError(10054) 会冒泡为
    # 未处理异常（Python 3.13 stdlib 未捕获 OSError），安装过滤器仅静默该良性模式（app/core/loop_guard.py）
    install_loop_guard()
    # Proactor accept 加固：客户端在 accept 完成前断开时 stdlib 会关闭监听 socket、服务停止
    # 接受新连接，补丁改为短暂退避后重挂 accept（app/core/loop_guard.py）
    install_proactor_accept_patch()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 数据库不可用不阻止启动
        logger.warning(
            "启动时数据库连接不可用（%s）：后端继续运行，安装流程会验证数据库连接，业务接口在数据库可用前不可用",
            exc,
        )
    # 运行时日志：先按环境变量默认初始化，再以系统设置 log.level 覆盖（管理后台可运行时调整）
    configure_logging(settings.log_level, settings.log_dir)
    try:
        db = SessionLocal()
        try:
            cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "log.level"))
            if cfg and cfg.config_value:
                set_log_level(cfg.config_value)
                logger.info("日志级别已按系统设置应用：%s", cfg.config_value)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 日志配置失败不影响启动
        logger.warning("读取系统设置日志级别失败：%s", exc)
    logger.info("后端启动完成（日志级别 %s，文件目录 %s）", logging.getLevelName(logging.getLogger().getEffectiveLevel()), settings.log_dir)
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    # 生产环境默认关闭 API 文档（DEBUG=true 时开放），避免暴露完整攻击面
    docs_url="/api/docs" if settings.debug else None,
    openapi_url="/api/openapi.json" if settings.debug else None,
)

app.add_exception_handler(BizError, biz_error_handler)


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """参数校验失败统一转 4006（《后端API设计.md》§11.8）。"""
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", []))
    msg = f"{loc}: {first.get('msg', '参数错误')}" if loc else "参数校验失败"
    return JSONResponse(status_code=200, content=err(E_PARAM, msg))


app.add_exception_handler(RequestValidationError, validation_error_handler)


_AUDIT_MAX_PENDING = 500  # 审计落库任务并发上限（防 executor 队列无界堆积）
_audit_semaphore = threading.Semaphore(_AUDIT_MAX_PENDING)
_audit_drop_logged_at = 0.0


def _audit_log(db, request: Request, status_code: int, duration_ms: int) -> None:
    """写操作审计（sys_operation_log）。fire-and-forget，失败不影响主流程。"""
    try:
        user = resolve_session_user(db, request.cookies.get(settings.session_cookie_name))
        module = request.url.path.removeprefix(settings.api_prefix).split("/")[1] or "-"
        db.add(
            SysOperationLog(
                user_id=user.id if user else 0,
                username=user.username if user else "",
                module=module,
                action=request.method,
                method=request.method,
                url=request.url.path,
                params=json.dumps(dict(request.query_params), ensure_ascii=False)[:2000],
                ip=request.client.host if request.client else "",
                user_agent=request.headers.get("user-agent", "")[:255],
                duration_ms=duration_ms,
            )
        )
        db.commit()
    except Exception:
        db.rollback()


async def audit_middleware(request: Request, call_next):
    start = time.time()
    try:
        response = await call_next(request)
    except Exception:
        logger.error("请求异常 %s %s", request.method, request.url.path, exc_info=True)
        raise
    duration_ms = int((time.time() - start) * 1000)
    # 文件日志：关键操作（写方法 + 非 2xx）记录 INFO/WARN，便于按天日志排障
    level = logging.INFO if response.status_code < 400 else logging.WARNING
    logger.log(level, "%s %s -> %s (%dms)", request.method, request.url.path, response.status_code, duration_ms)
    if request.method in ("POST", "PUT", "DELETE"):
        # 独立会话异步落库，避免占用请求事务；用信号量给 executor 队列设上限，
        # 积压超过上限时丢弃审计记录并节流告警（宁可丢审计，不可让审计拖垮主流程/内存）
        if _audit_semaphore.acquire(blocking=False):
            def _run() -> None:
                db = SessionLocal()
                try:
                    _audit_log(db, request, response.status_code, duration_ms)
                finally:
                    db.close()
                    _audit_semaphore.release()

            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:  # 非异步上下文（测试直接调用）兜底
                loop = asyncio.get_event_loop()
            loop.run_in_executor(None, _run)
        else:
            global _audit_drop_logged_at
            now = time.monotonic()
            if now - _audit_drop_logged_at >= 60:
                _audit_drop_logged_at = now
                logger.warning("审计日志队列已满（>%d），丢弃本次审计记录 %s %s", _AUDIT_MAX_PENDING, request.method, request.url.path)
    return response


# 中间件注册顺序决定执行顺序（后注册者更靠外层）：CORS（跨域头）→ 限流（反刷屏）→ 审计（最内层）。
# 被限请求在审计之前直接 429 返回：不写操作日志，避免洪泛放大审计 DB 写；/health 豁免见 app/core/ratelimit.py
app.add_middleware(BaseHTTPMiddleware, dispatch=audit_middleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_api.router, prefix=settings.api_prefix)
app.include_router(init_api.router, prefix=settings.api_prefix)  # 初始化安装（首次启动引导，公开）
app.include_router(base_data_api.static_router, prefix=settings.api_prefix)  # 先于动态路由注册（/products/export 等静态路径）
app.include_router(base_data_api.router, prefix=settings.api_prefix)
app.include_router(stock_api.router, prefix=settings.api_prefix)
app.include_router(advanced_api.router, prefix=settings.api_prefix)
app.include_router(admin_api.router, prefix=settings.api_prefix)
app.include_router(requisition_api.router, prefix=settings.api_prefix)
app.include_router(report_api.router, prefix=settings.api_prefix)
app.include_router(ocr_api.router, prefix=settings.api_prefix)
app.include_router(notification_api.router, prefix=settings.api_prefix)
app.include_router(files_api.router, prefix=settings.api_prefix)
app.include_router(storage_api.router, prefix=settings.api_prefix)
app.include_router(system_api.router, prefix=settings.api_prefix)
app.include_router(geo_api.router, prefix=settings.api_prefix)
