"""统一响应与业务异常（《后端API设计.md》§0、§11.8）。"""
from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


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
E_OCR_UNAVAILABLE = 5001  # OCR 引擎未初始化
E_LLM_FAILED = 5002  # 大模型调用失败
E_FILE_FAILED = 5003  # 文件处理失败


def ok(data: Any = None) -> dict:
    return {"code": 0, "message": "ok", "data": data}


def err(code: int, message: str) -> dict:
    return {"code": code, "message": message, "data": None}


async def biz_error_handler(request: Request, exc: BizError) -> JSONResponse:
    return JSONResponse(status_code=exc.http_status, content=err(exc.code, exc.message))
