"""接口限流（反刷屏/反垃圾）：每 IP 滑动窗口计数，超限优雅拒绝（《后端API设计.md》§11.12）。

- 单进程内存态（与验证码/重置码一致），重启清零；
- 中间件注册在 CORS 之后、审计日志之前：被限请求直接 429 返回且不落操作日志，
  避免洪泛放大审计 DB 写；
- /health 豁免（运维探活不受影响）。
"""
from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Any, Awaitable, Callable

from fastapi.responses import JSONResponse

from app.config import settings
from app.core.response import E_RATE_LIMITED, err

logger = logging.getLogger("app.ratelimit")

MESSAGE = "请求过于频繁，请稍后再试"
# 运维探活豁免（外部监控通常高频轮询 /health）
EXEMPT_PATHS = frozenset({settings.api_prefix + "/health"})
# 被限客户端日志节流：同一 IP 最多每 30 秒记一条 WARNING，避免日志自身被洪泛放大
LOG_THROTTLE_SECONDS = 30.0


class RateLimiter:
    """滑动窗口计数器（线程安全）；窗口内超过 limit 次即拒绝。"""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_cleanup = 0.0  # 全表清理时间戳（防空闲 IP 的 key 永久残留）

    def _cleanup_locked(self, now: float) -> None:
        """周期清理过期时间戳与空桶（每 5 分钟一次，保持 key 数量有界）。"""
        if now - self._last_cleanup < 300:
            return
        self._last_cleanup = now
        cutoff = now - self.window_seconds
        for key in list(self._hits.keys()):
            hits = self._hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if not hits:
                del self._hits[key]

    def allow(self, key: str) -> tuple[bool, int]:
        """登记一次访问。返回 (是否放行, 若被拒需等待秒数)。"""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            self._cleanup_locked(now)
            hits = self._hits.get(key)
            if hits is None:
                self._hits[key] = deque([now])
                return True, 0
            while hits and hits[0] <= cutoff:
                hits.popleft()  # 惰性清理过期时间戳，保持内存有界
            if len(hits) >= self.limit:
                retry_after = int(hits[0] + self.window_seconds - now) + 1
                return False, retry_after
            hits.append(now)
            return True, 0

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()
            self._last_cleanup = time.monotonic()


# 模块级共享实例：默认按 settings 构造；测试可整体替换
limiter = RateLimiter(settings.rate_limit_requests, settings.rate_limit_window_seconds)


def _client_ip(scope: dict[str, Any]) -> str:
    """限流计数的客户端 IP。

    - 直连：直接用 TCP 对端 IP（scope["client"]）。
    - 反向代理：uvicorn --proxy-headers 已重写 scope["client"]；若运维漏配，
      当对端是本机回环且带 X-Forwarded-For 时兜底取 XFF 第一个地址，
      避免生产 Nginx 反代下所有请求都记到 127.0.0.1 一个桶里。
    直连用户伪造 XFF 不影响计数（对端非回环时不采信代理头）。
    """
    client = scope.get("client")
    ip = client[0] if client else "unknown"
    if ip in ("127.0.0.1", "::1"):
        xff = ""
        for name, value in scope.get("headers") or []:
            if name == b"x-forwarded-for":
                xff = value.decode("latin-1")
                break
        first = xff.split(",")[0].strip() if xff else ""
        if first:
            return first
    return ip


class RateLimitMiddleware:
    """全局限流：按客户端 IP 计数，超限返回 429 + code 4008 + Retry-After + Connection: close。"""

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app
        self._last_logged: dict[str, float] = {}
        self._log_lock = threading.Lock()

    def _should_log(self, key: str) -> bool:
        now = time.monotonic()
        with self._log_lock:
            last = self._last_logged.get(key, 0.0)
            if now - last < LOG_THROTTLE_SECONDS:
                return False
            self._last_logged[key] = now
            return True

    async def __call__(self, scope: dict[str, Any], receive: Callable[..., Awaitable[dict[str, Any]]], send: Callable[..., Awaitable[None]]) -> None:
        if scope["type"] != "http" or not settings.rate_limit_enabled:
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if path in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return
        key = _client_ip(scope)
        allowed, retry_after = limiter.allow(key)
        if not allowed:
            if self._should_log(key):
                logger.warning("接口限流触发：IP=%s path=%s，拒绝并关闭连接（Retry-After=%ds）", key, path, retry_after)
            response = JSONResponse(
                status_code=429,
                content=err(E_RATE_LIMITED, MESSAGE),
                headers={"Retry-After": str(retry_after), "Connection": "close"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
