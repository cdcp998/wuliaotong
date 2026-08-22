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
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app import __version__
from app.api import auth as auth_api
from app.api import admin as admin_api
from app.api import advanced as advanced_api
from app.api import base_data as base_data_api
from app.api import files as files_api
from app.api import geo as geo_api
from app.api import init as init_api
from app.api import menu as menu_api
from app.api import modules as modules_api
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
from app.core.modules import register_modules
from app.core.ratelimit import RateLimitMiddleware
from app.core.response import BizError, E_NOT_FOUND, E_NO_PERMISSION, E_PARAM, E_RATE_LIMITED, biz_error_handler, err
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
    version=__version__,  # 单一事实源（app/__init__.py），避免与 __version__ 漂移
    lifespan=lifespan,
    # 生产环境默认关闭 API 文档（DEBUG=true 时开放），避免暴露完整攻击面
    docs_url="/api/docs" if settings.debug else None,
    openapi_url="/api/openapi.json" if settings.debug else None,
)

app.add_exception_handler(BizError, biz_error_handler)


def _zh_validation_msg(e: dict) -> str:
    """pydantic v2 校验错误 → 中文提示（面向用户，避免英文原文透传）。"""
    t = e.get("type", "")
    ctx = e.get("ctx") or {}
    if t == "value_error":  # 业务自定义 ValueError：消息已是业务中文
        return str(e.get("msg", "参数错误")).removeprefix("Value error, ")
    if t == "missing":
        return "该字段必填"
    if t == "extra_forbidden":
        return "不允许的字段"
    if t in ("int_parsing", "int_from_float"):
        return "必须是整数"
    if t in ("float_parsing", "decimal_parsing"):
        return "必须是数字"
    if t == "bool_parsing":
        return "必须是布尔值"
    if t == "string_type":
        return "必须是字符串"
    if t == "string_too_long":
        return f"长度不能超过 {ctx.get('max_length', '')}"
    if t == "string_too_short":
        return f"长度不能少于 {ctx.get('min_length', '')}"
    if t == "string_pattern_mismatch":
        return "格式不正确"
    if t == "json_invalid":
        return "请求体不是有效的 JSON"
    if t == "less_than":
        return f"数值必须小于 {ctx.get('lt', '')}"
    if t == "less_than_equal":
        return f"数值不能超过 {ctx.get('le', '')}"
    if t == "greater_than":
        return f"数值必须大于 {ctx.get('gt', '')}"
    if t == "greater_than_equal":
        return f"数值不能小于 {ctx.get('ge', '')}"
    if t in ("date_parsing", "datetime_parsing"):
        return "日期格式不正确"
    if t in ("enum", "literal_error"):
        return "取值不在允许范围内"
    if t in ("list_type", "dict_type", "tuple_type"):
        return "类型不正确"
    return str(e.get("msg", "参数错误"))


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """参数校验失败统一转 4006（《后端API设计.md》§11.8），错误消息中文化，HTTP 400。"""
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", []))
    msg = _zh_validation_msg(first)
    return JSONResponse(status_code=400, content=err(E_PARAM, f"{loc}: {msg}" if loc else msg))


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """HTTP 层异常（404/405/401 等）→ 中文提示 + 语义化业务码，HTTP 状态透传（不再统一 200）。"""
    status = getattr(exc, "status_code", 500)
    msg = {
        400: "请求参数错误",
        401: "未登录或会话已过期",
        403: "无权限执行该操作",
        404: "资源不存在",
        405: "请求方法不允许",
        429: "请求过于频繁，请稍后重试",
    }.get(status, f"请求失败（HTTP {status}）")
    code = {400: E_PARAM, 401: 4004, 403: E_NO_PERMISSION, 404: E_NOT_FOUND, 405: E_PARAM, 429: E_RATE_LIMITED}.get(status, 500)
    return JSONResponse(status_code=status, content=err(code, msg))


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """未捕获异常兜底：面向用户只给中文提示，详情进日志（含异常原文，供排障）。"""
    logger.exception("未处理异常：%s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content=err(500, "服务器内部错误，请稍后重试（详情见系统日志）"))


app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)


_AUDIT_MAX_PENDING = 500  # 审计落库任务并发上限（防 executor 队列无界堆积）
_audit_semaphore = threading.Semaphore(_AUDIT_MAX_PENDING)
_audit_drop_logged_at = 0.0

# ============================ 操作日志中文化（路由 → 具体动作） ============================
# 写操作审计：把「模块(英文URL段) + 方法(POST/PUT/DELETE)」翻译为中文、具体化的操作描述。
# 匹配规则：(方法, 归一化路径（数字段→{id}）) → 中文动作；未匹配走模块+动词兜底。

_AUDIT_MODULES = {
    "auth": "认证", "login": "认证", "logout": "认证", "password": "认证", "forgot": "认证",
    "system": "系统", "settings": "系统设置", "admin": "系统管理",
    "users": "用户", "roles": "角色", "register-applies": "注册审核", "logs": "日志",
    "backups": "备份", "products": "材料", "categories": "分类", "suppliers": "供应商",
    "units": "单位", "warehouses": "仓库", "shelves": "货架", "locations": "库位",
    "departments": "组织单位", "delete-reviews": "删除审核", "menus": "导航管理", "modules": "模块",
    "purchase-in": "采购入库", "purchase-plans": "采购计划", "opening": "期初",
    "transfers": "库存调拨", "checks": "盘点", "other-io": "其他出入库",
    "requisitions": "领用申请", "notifications": "通知", "ocr": "OCR/大模型",
    "ai-suggestions": "AI建议", "files": "文件", "storages": "存储", "llm-logs": "AI调用日志",
    "storage": "存储", "geo": "定位", "init": "初始化", "-": "其他",
}

_AUDIT_METHOD_VERB = {"POST": "新增", "PUT": "修改", "DELETE": "删除"}

_AUDIT_ACTIONS: dict[tuple[str, str], str] = {
    ("POST", "/login"): "登录系统",
    ("POST", "/logout"): "退出登录",
    ("PUT", "/password"): "修改密码",
    ("POST", "/forgot"): "申请找回密码",
    ("POST", "/forgot/reset"): "重置密码",
    ("POST", "/register"): "提交注册申请",
    ("PUT", "/settings"): "修改系统设置",
    ("POST", "/watermark/preview"): "预览水印效果",
    ("POST", "/users"): "新增用户",
    ("PUT", "/users/{id}"): "编辑用户",
    ("DELETE", "/users/{id}"): "删除用户",
    ("POST", "/roles"): "新增角色",
    ("PUT", "/roles/{id}"): "编辑角色",
    ("DELETE", "/roles/{id}"): "删除角色",
    ("PUT", "/roles/{id}/permissions"): "更新角色权限",
    ("POST", "/register-applies/{id}/approve"): "审核通过注册申请",
    ("POST", "/register-applies/{id}/reject"): "驳回注册申请",
    ("POST", "/categories"): "新增分类",
    ("PUT", "/categories/{id}"): "编辑分类",
    ("DELETE", "/categories/{id}"): "删除分类",
    ("POST", "/products"): "新增材料",
    ("PUT", "/products/{id}"): "编辑材料",
    ("DELETE", "/products/{id}"): "停用材料",
    ("PUT", "/products/{id}/category"): "修改材料分类",
    ("POST", "/products/import"): "批量导入材料",
    ("POST", "/products/dedupe-scan"): "材料查重扫描",
    ("POST", "/products/{id}/mark-duplicate"): "标记材料重复",
    ("POST", "/suppliers"): "新增供应商",
    ("PUT", "/suppliers/{id}"): "编辑供应商",
    ("DELETE", "/suppliers/{id}"): "停用供应商",
    ("POST", "/suppliers/merge"): "合并供应商",
    ("POST", "/suppliers/import"): "批量导入供应商",
    ("POST", "/delete-reviews"): "提交删除申请",
    ("POST", "/delete-reviews/{id}/approve"): "通过删除申请并执行删除",
    ("POST", "/delete-reviews/{id}/reject"): "驳回删除申请",
    ("POST", "/warehouses"): "新增仓库",
    ("PUT", "/warehouses/{id}"): "编辑仓库",
    ("DELETE", "/warehouses/{id}"): "停用仓库",
    ("POST", "/shelves"): "新增货架（批量生成库位）",
    ("PUT", "/shelves/{id}"): "编辑货架",
    ("DELETE", "/shelves/{id}"): "删除货架",
    ("POST", "/locations"): "新增库位",
    ("PUT", "/locations/{id}"): "编辑库位",
    ("DELETE", "/locations/{id}"): "删除库位",
    ("POST", "/departments"): "新增组织单位",
    ("PUT", "/departments/{id}"): "编辑组织单位",
    ("DELETE", "/departments/{id}"): "删除组织单位",
    ("PUT", "/departments/{id}/shelves"): "设置单位可用货架",
    ("POST", "/menus"): "新增导航菜单",
    ("PUT", "/menus/{id}"): "编辑导航菜单",
    ("DELETE", "/menus/{id}"): "删除导航菜单",
    ("POST", "/purchase-in"): "材料采购入库",
    ("POST", "/purchase-in/{id}/void"): "作废入库单（冲销库存）",
    ("POST", "/purchase-plans"): "新建采购计划单",
    ("PUT", "/purchase-plans/{id}"): "编辑采购计划单",
    ("POST", "/purchase-plans/{id}/submit"): "提交采购计划单",
    ("POST", "/purchase-plans/{id}/void"): "作废采购计划单",
    ("POST", "/opening"): "期初建账",
    ("PUT", "/opening/{id}"): "编辑期初",
    ("POST", "/opening/{id}/post"): "期初过账",
    ("POST", "/opening/import"): "批量导入期初",
    ("POST", "/transfers"): "新增库存调拨",
    ("POST", "/transfers/{id}/audit"): "调拨审核通过",
    ("POST", "/transfers/{id}/reject"): "驳回调拨",
    ("POST", "/transfers/{id}/void"): "作废库存调拨",
    ("POST", "/checks"): "新建盘点单",
    ("PUT", "/checks/{id}/items"): "更新盘点明细",
    ("POST", "/checks/{id}/audit"): "盘点审核",
    ("POST", "/other-io"): "其他出入库",
    ("POST", "/other-io/{id}/void"): "作废其他出入库单",
    ("POST", "/requisitions"): "提交领用申请",
    ("PUT", "/requisitions/{id}"): "编辑领用申请",
    ("POST", "/requisitions/{id}/cancel"): "取消领用申请",
    ("POST", "/requisitions/{id}/audit"): "领用审计（通过/驳回）",
    ("PUT", "/requisitions/{id}/display"): "更新申请显示状态",
    ("PUT", "/requisitions/{id}/work-location"): "更新工作地点",
    ("POST", "/requisitions/{id}/work-done"): "完成工作（拍照留痕）",
    ("POST", "/ocr/recognize"): "送货单识别",
    ("POST", "/ocr/quick"): "拍照快查识别",
    ("POST", "/ocr/classify"): "材料自动分类",
    ("POST", "/ocr/template/train"): "训练本地 OCR 模板",
    ("DELETE", "/ocr/templates/{id}"): "删除 OCR 模板",
    ("POST", "/ocr/delivery/confirm"): "送货单确认并入库",
    ("POST", "/ocr/match"): "AI 建议分析",
    ("POST", "/ai-suggestions/{id}/accept"): "采纳 AI 建议新增材料",
    ("POST", "/ai-suggestions/{id}/ignore"): "忽略 AI 建议",
    ("PUT", "/notifications/{id}/read"): "标记通知已读",
    ("PUT", "/notifications/read-all"): "全部通知标记已读",
    ("DELETE", "/notifications/{id}"): "删除通知",
    ("POST", "/notifications/delete"): "批量删除通知",
    ("DELETE", "/notifications"): "清空通知",
    ("POST", "/files/upload"): "上传文件",
    ("POST", "/storages"): "新增存储位置",
    ("PUT", "/storages/{id}"): "编辑存储位置",
    ("DELETE", "/storages/{id}"): "删除存储位置",
    ("DELETE", "/llm-logs"): "批量删除 AI 调用日志",
    ("POST", "/llm-logs/{id}/replay"): "重放大模型调用",
    ("POST", "/backups"): "创建数据备份",
    ("DELETE", "/backups/{id}"): "删除备份文件",
    ("POST", "/ocr/install-paddle"): "安装 PP-OCR 引擎",
    ("POST", "/modules/{code}/install"): "安装模块",
    ("POST", "/modules/{code}/enable"): "启用模块",
    ("POST", "/modules/{code}/disable"): "停用模块",
    ("POST", "/modules/{code}/upgrade"): "升级模块",
    ("POST", "/modules/{code}/uninstall"): "卸载模块",
    ("POST", "/modules/rescan"): "重新扫描模块源码",
}


def _audit_normalize_path(path: str) -> str:
    """归一化路径：去掉 api 前缀，数字段 → {id}（如 /api/v1/products/123/category → /products/{id}/category）；
    模块管理路由 /modules/{code}/... → /modules/{code}/...（code 为字符段，需显式归一）。"""
    p = path.removeprefix(settings.api_prefix)
    segs = ["{id}" if seg.isdigit() else seg for seg in p.split("/") if seg]
    if len(segs) >= 3 and segs[0] == "modules":
        segs[1] = "{code}"
    return "/" + "/".join(segs) if segs else "/"


def _audit_action(method: str, path: str) -> tuple[str, str]:
    """操作描述 + 中文模块（未匹配路由按模块+动词兜底）。"""
    raw = path.removeprefix(settings.api_prefix)
    seg = raw.split("/")[1] if raw.count("/") >= 1 else "-"
    module = _AUDIT_MODULES.get(seg, _AUDIT_MODULES.get("-", "其他"))
    norm = _audit_normalize_path(path)
    hit = _AUDIT_ACTIONS.get((method, norm))
    if hit:
        return hit, module
    verb = _AUDIT_METHOD_VERB.get(method, "操作")
    return f"{module}{verb}", module


def _audit_log(db, request: Request, status_code: int, duration_ms: int) -> None:
    """写操作审计（sys_operation_log）。fire-and-forget，失败不影响主流程。"""
    try:
        user = resolve_session_user(db, request.cookies.get(settings.session_cookie_name))
        action, module = _audit_action(request.method, request.url.path)
        db.add(
            SysOperationLog(
                user_id=user.id if user else 0,
                username=user.username if user else "",
                module=module,
                action=action,
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
app.include_router(menu_api.router, prefix=settings.api_prefix)
app.include_router(files_api.router, prefix=settings.api_prefix)
app.include_router(storage_api.router, prefix=settings.api_prefix)
app.include_router(system_api.router, prefix=settings.api_prefix)
app.include_router(geo_api.router, prefix=settings.api_prefix)
app.include_router(modules_api.router, prefix=settings.api_prefix)

# 模块插件加载器（线缆和设备插件方案 §2.2）：
# - 登记源码已部署模块（NOT_INSTALLED，不自动安装）
# - 挂载模块路由（模块 router 自带 require_module_enabled 依赖：未启用即时 403）
# - sys_module 表不存在/数据库不可用 → 静默跳过（核心启动不受影响）
_module_register_summary = register_modules(app)
if _module_register_summary["modules"]:
    from app.core.modules import module_audit_labels

    _AUDIT_MODULES.update(module_audit_labels())
    logger.info(
        "模块插件加载完成：%s（登记 %d，挂载 %d）",
        ",".join(_module_register_summary["modules"]),
        _module_register_summary["registered"],
        len(_module_register_summary["mounted"]),
    )
