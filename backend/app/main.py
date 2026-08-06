"""应用入口：lifespan、中间件（审计日志）、路由注册、异常处理。"""
from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import auth as auth_api
from app.api import base_data as base_data_api
from app.api import stock as stock_api
from app.api import system as system_api
from app.config import settings
from app.core.deps import resolve_session_user
from app.core.response import BizError, biz_error_handler
from app.db import SessionLocal, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动自检：数据库连通性。"""
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(BizError, biz_error_handler)


def _audit_log(db, request: Request, status_code: int, duration_ms: int) -> None:
    """写操作审计（sys_operation_log）。fire-and-forget，失败不影响主流程。"""
    try:
        user = resolve_session_user(db, request.cookies.get(settings.session_cookie_name))
        module = request.url.path.removeprefix(settings.api_prefix).split("/")[1] or "-"
        db.add(
            __import__("app.models.sys", fromlist=["SysOperationLog"]).SysOperationLog(
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


@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = int((time.time() - start) * 1000)
    if request.method in ("POST", "PUT", "DELETE"):
        # 独立会话异步落库，避免占用请求事务
        def _run() -> None:
            db = SessionLocal()
            try:
                _audit_log(db, request, response.status_code, duration_ms)
            finally:
                db.close()

        asyncio.get_event_loop().run_in_executor(None, _run)
    return response


app.include_router(auth_api.router, prefix=settings.api_prefix)
app.include_router(base_data_api.static_router, prefix=settings.api_prefix)  # 先于动态路由注册（/products/export 等静态路径）
app.include_router(base_data_api.router, prefix=settings.api_prefix)
app.include_router(stock_api.router, prefix=settings.api_prefix)
app.include_router(system_api.router, prefix=settings.api_prefix)
