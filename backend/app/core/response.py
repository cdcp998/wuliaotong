"""统一响应与业务异常（《后端API设计.md》§0、§11.8）。"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("app.biz")


class BizError(Exception):
    """业务异常：携带错误码与提示语，由全局处理器转为统一响应体。"""

    def __init__(self, code: int, message: str, http_status: int = 200) -> None:
        self.code = code
        self.message = message
        self.http_status = http_status
        super().__init__(message)


# 错误码（§11.8，禁止自造新码）
E_STOCK_NOT_ENOUGH = 4001  # 库存不足
E_BILL_STATUS = 4002  # 单据状态不允许
E_NOT_FOUND = 4003  # 商品或库位不存在
E_LOGIN_FAILED = 4004  # 登录失败/未登录/已锁定
E_NO_PERMISSION = 4005  # 无权限
E_PARAM = 4006  # 参数校验失败
E_CAPTCHA = 4007  # 需要验证码（登录连续失败后触发）
E_RATE_LIMITED = 4008  # 请求过于频繁（接口限流触发，HTTP 429）
E_OCR_UNAVAILABLE = 5001  # OCR 引擎未初始化
E_LLM_FAILED = 5002  # 大模型调用失败
E_FILE_FAILED = 5003  # 文件处理失败

# 业务错误码 → HTTP 状态语义化映射（避免统一返回 200）：
# - 资源不存在 → 404；参数错误 → 400；权限 → 403；限流 → 429；冲突（库存/状态） → 409；服务端 → 500。
# - 显式传入 BizError(http_status=...) 时以显式值为准。
# - E_LOGIN_FAILED 保持 200：登录接口自身的失败（密码错误/锁定）沿用业务码约定，
#   会话失效场景由 deps 显式抛 http_status=401 触发前端跳登录。
_STATUS_BY_CODE: dict[int, int] = {
    E_STOCK_NOT_ENOUGH: 409,
    E_BILL_STATUS: 409,
    E_NOT_FOUND: 404,
    E_NO_PERMISSION: 403,
    E_PARAM: 400,
    E_CAPTCHA: 400,
    E_RATE_LIMITED: 429,
}


def ok(data: Any = None) -> dict:
    return {"code": 0, "message": "ok", "data": data}


def err(code: int, message: str) -> dict:
    return {"code": code, "message": message, "data": None}


async def biz_error_handler(request: Request, exc: BizError) -> JSONResponse:
    # 服务端类错误（5xx）记录日志（含异常原文），用户侧只展示中文摘要
    if exc.code >= 5000:
        logger.warning("业务异常 code=%s %s %s：%s", exc.code, request.method, request.url.path, exc.message)
    if exc.http_status != 200:
        status = exc.http_status
    elif exc.code >= 5000:
        status = 500
    else:
        status = _STATUS_BY_CODE.get(exc.code, 200)
    return JSONResponse(status_code=status, content=err(exc.code, exc.message))
