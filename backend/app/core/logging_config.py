"""运行时日志配置：控制台 + 按天轮转文件（logs/app-YYYY-MM-DD.log）。

- 级别：DEBUG / INFO / WARN / ERROR，默认 INFO（环境变量 LOG_LEVEL 或系统设置 log.level 覆盖）
- 运行时调整：set_log_level() 立即生效（系统设置 PUT /settings log.level 调用）
- 文件按天轮转：每天一个新文件 app-YYYY-MM-DD.log（单进程部署；跨天自动切换）
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import TextIO

LOG_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARN": logging.WARNING,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
}
_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"
_configured = False
_configured_lock = threading.Lock()


class DailyFileHandler(logging.Handler):
    """按天轮转文件日志：每天一个 {prefix}-YYYY-MM-DD.log，跨天自动切换到新文件。"""

    def __init__(self, log_dir: str, prefix: str = "app") -> None:
        super().__init__()
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.prefix = prefix
        self._stream: TextIO | None = None
        self._current_date = ""
        self._lock = threading.Lock()

    def _ensure_stream(self) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        if self._stream is None or today != self._current_date:
            if self._stream:
                self._stream.close()
            path = self.log_dir / f"{self.prefix}-{today}.log"
            self._stream = open(path, "a", encoding="utf-8")
            self._current_date = today

    def emit(self, record: logging.LogRecord) -> None:
        try:
            with self._lock:
                self._ensure_stream()
                assert self._stream is not None
                self._stream.write(self.format(record) + "\n")
                self._stream.flush()
        except Exception:  # noqa: BLE001 日志失败不影响业务
            self.handleError(record)

    def close(self) -> None:
        with self._lock:
            if self._stream:
                self._stream.close()
                self._stream = None
        super().close()


def _resolve_level(level_name: str | None) -> int:
    """级别名 → logging 级别数字；无效抛 ValueError（DEBUG/INFO/WARN/ERROR）。"""
    name = (level_name or "INFO").strip().upper()
    if name not in LOG_LEVELS:
        raise ValueError(f"无效日志级别：{level_name}（可选 DEBUG/INFO/WARN/ERROR）")
    return LOG_LEVELS[name]


def configure_logging(level_name: str | None = None, log_dir: str | None = None) -> None:
    """初始化根日志与 uvicorn 日志（控制台 + 按天文件）。可重复调用（幂等，不重复加 handler）。"""
    global _configured
    with _configured_lock:
        if _configured:
            return
        level = _resolve_level(level_name or os.getenv("LOG_LEVEL", "INFO"))
        fmt = logging.Formatter(_FORMAT, datefmt=_DATEFMT)
        root = logging.getLogger()
        root.setLevel(level)
        fh = DailyFileHandler(log_dir or os.getenv("LOG_DIR", "logs"))
        fh.setLevel(level)
        fh.setFormatter(fmt)
        root.addHandler(fh)
        ch = logging.StreamHandler()
        ch.setLevel(level)
        ch.setFormatter(fmt)
        root.addHandler(ch)
        # uvicorn 访问/错误日志写入同一文件（保留原有控制台输出）
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            lg = logging.getLogger(name)
            lg.setLevel(level)
            lg.addHandler(fh)
        # 第三方库 DEBUG 噪音隔离（httpx/httpcore 等网络库），保持业务日志可读
        for name in ("httpx", "httpcore", "urllib3", "paddle", "paddlex"):
            logging.getLogger(name).setLevel(logging.WARNING)
        _configured = True


def set_log_level(level_name: str) -> None:
    """运行时调整日志级别（root + uvicorn + 已有 handler 全部生效）。无效级别抛 ValueError。"""
    level = _resolve_level(level_name)
    logging.getLogger().setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).setLevel(level)
    for handler in logging.getLogger().handlers:
        handler.setLevel(level)


def get_log_level() -> str:
    """当前生效级别名（DEBUG/INFO/WARN/ERROR）。"""
    return logging.getLevelName(logging.getLogger().getEffectiveLevel())
