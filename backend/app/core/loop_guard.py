"""Windows Proactor 事件循环良性异常过滤 + accept 加固（《后端API设计.md》§11.12）。

背景（Python 3.13，Windows 默认 Proactor 事件循环，stdlib 缺陷）：
1. 客户端强制断开连接时，_ProactorBasePipeTransport._call_connection_lost() 内
   sock.shutdown(SHUT_RDWR) 未捕获 OSError（WinError 10054/10053/64 等），异常从
   call_soon 回调冒泡为「asyncio 未处理异常」ERROR 日志；
2. 客户端在 accept 完成前断开时（刷屏/快速重连场景），IocpProactor 的 accept 完成
   回调抛同类 OSError，且 BaseProactorEventLoop._start_serving 的 except OSError
   分支会直接关闭监听 socket——服务器从此拒绝所有新连接（表现为「连接被重置」）；
   同时 accept_coro 任务异常无人消费，产生「Task exception was never retrieved」。

限流（app/core/ratelimit.py）能降低触发频率，但正常客户端瞬断仍可能触发，故本模块
安装两层防护（幂等，任何一步失败不影响其余防护）：
- 事件循环异常过滤器：仅静默良性连接重置（DEBUG 日志），其余异常链到原处理器；
- Proactor accept 加固补丁：良性 accept 错误改为「短暂退避后重挂 accept」而非关闭
  监听 socket；accept_coro 吞掉 OSError 避免任务异常（非良性错误仍走默认处理）。

补丁按本机 3.13.8 stdlib 源码逐字复制 + 单一改动；安装前校验源码标记，版本漂移时
跳过并告警（不影响限流与异常过滤器）。
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import socket
import struct
import sys
from asyncio import trsock
from typing import Any

logger = logging.getLogger("app.loop_guard")

# 客户端强制断开/连接被重置的良性 Windows 错误码（winerror；WSA 码与 errno 相同）
# 64=ERROR_NETNAME_DELETED  10053=WSAECONNABORTED  10054=WSAECONNRESET
# 995=ERROR_OPERATION_ABORTED  996=ERROR_IO_INCOMPLETE  1236=ERROR_CONNECTION_ABORTED
_BENIGN_ERRNOS = frozenset({64, 10053, 10054, 995, 996, 1236})
# 触发点回调名（proactor_events.py::_ProactorBasePipeTransport._call_connection_lost）
_CALLBACK_MARKER = "_call_connection_lost"


def _is_benign_os_error(exc: OSError) -> bool:
    """按 Windows 原始错误码（winerror）判定良性错误。

    非 WSA 的系统错误（如 ERROR_NETNAME_DELETED=64）会被映射到 POSIX errno（22 EINVAL），
    因此必须优先用 winerror 判定；WSA 错误码（10053/10054 等）与 errno 相同。
    """
    code = exc.winerror if exc.winerror is not None else exc.errno
    return code in _BENIGN_ERRNOS


def is_benign_connection_lost(context: dict[str, Any]) -> bool:
    """判定事件循环异常上下文是否为「客户端强制断开导致的连接关闭回调异常」。

    要求同时满足：异常为 OSError 且错误码属于已知良性集合；回调 repr 或
    消息含 _call_connection_lost 标记。双重条件避免误吞其他 OSError。
    """
    exc = context.get("exception")
    if not isinstance(exc, OSError) or not _is_benign_os_error(exc):
        return False
    handle = context.get("handle")
    if handle is not None and _CALLBACK_MARKER in repr(handle):
        return True
    return _CALLBACK_MARKER in context.get("message", "")


def install_loop_guard(loop: asyncio.AbstractEventLoop | None = None) -> None:
    """包装事件循环异常处理器：良性连接重置静默，其余异常链到原处理器（无则默认处理）。"""
    if loop is None:
        loop = asyncio.get_running_loop()
    previous = loop.get_exception_handler()

    def handler(loop_: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        if is_benign_connection_lost(context):
            logger.debug("忽略良性连接重置（客户端强制断开）：%s", context.get("message", ""))
            return
        if previous is not None:
            previous(loop_, context)
        else:
            loop_.default_exception_handler(context)

    loop.set_exception_handler(handler)


# ---------- Proactor accept 加固（stdlib 缺陷规避） ----------

_BENIGN_ACCEPT_ERRNOS = frozenset({64, 10053, 10054, 995, 996, 1236})
_ACCEPT_MARKER = "Accept failed on a socket"
_accept_patch_installed = False


def _source_has(func: object, marker: str) -> bool:
    """源码标记校验：防止 Python 版本漂移后把补丁装到不匹配的实现上。"""
    try:
        return marker in inspect.getsource(func)
    except (OSError, TypeError):
        return False


def _patch_start_serving(loop_cls: type) -> None:
    """BaseProactorEventLoop._start_serving：良性 accept 错误重挂 accept，不关闭监听 socket。

    以 3.13.8 stdlib 实现为基线，仅在 except OSError 分支增加良性错误码判断。
    """

    def _start_serving(
        self,
        protocol_factory: Any,
        sock: socket.socket,
        sslcontext: Any = None,
        server: Any = None,
        backlog: int = 100,
        ssl_handshake_timeout: float | None = None,
        ssl_shutdown_timeout: float | None = None,
    ) -> None:
        def loop(f: asyncio.Future | None = None) -> None:
            try:
                if f is not None:
                    conn, addr = f.result()
                    if self._debug:
                        logger.debug("%r got a new connection from %r: %r", server, addr, conn)
                    protocol = protocol_factory()
                    if sslcontext is not None:
                        self._make_ssl_transport(
                            conn, protocol, sslcontext, server_side=True,
                            extra={"peername": addr}, server=server,
                            ssl_handshake_timeout=ssl_handshake_timeout,
                            ssl_shutdown_timeout=ssl_shutdown_timeout,
                        )
                    else:
                        self._make_socket_transport(
                            conn, protocol,
                            extra={"peername": addr}, server=server,
                        )
                if self.is_closed():
                    return
                f = self._proactor.accept(sock)
            except OSError as exc:
                if sock.fileno() != -1:
                    if _is_benign_os_error(exc):
                        # 客户端在 accept 完成前断开：良性瞬时错误——短暂退避后重挂 accept。
                        # stdlib 3.13 此处直接关闭监听 socket，导致服务器停止接受新连接（已知缺陷）
                        logger.debug("Accept transient error %r on %r，50ms 后重挂 accept", exc, sock)
                        self.call_later(0.05, loop)
                    else:
                        self.call_exception_handler({
                            "message": _ACCEPT_MARKER,
                            "exception": exc,
                            "socket": trsock.TransportSocket(sock),
                        })
                        sock.close()
                elif self._debug:
                    logger.debug("Accept failed on socket %r", sock, exc_info=True)
            except asyncio.CancelledError:
                sock.close()
            else:
                self._accept_futures[sock.fileno()] = f
                f.add_done_callback(loop)

        self.call_soon(loop)

    loop_cls._start_serving = _start_serving  # type: ignore[method-assign]


def _patch_proactor_accept() -> bool:
    """IocpProactor.accept：accept_coro 吞掉 OSError，消除「Task exception was never retrieved」。

    监听 socket 的处理由 _start_serving 补丁负责；此处仅避免 accept 任务异常噪音，
    连接套接字在失败时关闭（stdlib 原实现会泄漏）。
    """
    try:
        from asyncio import windows_events
    except ImportError:
        return False
    if not (_source_has(windows_events.IocpProactor.accept, "accept_coro")
            and _source_has(windows_events.IocpProactor.accept, "AcceptEx")):
        return False
    _overlapped = windows_events._overlapped
    NULL = windows_events._winapi.NULL

    async def accept_coro(future: asyncio.Future, conn: socket.socket) -> None:
        try:
            await future
        except asyncio.CancelledError:
            conn.close()
            raise
        except OSError:
            # 良性 accept 失败（客户端在完成前断开等）：连接套接字作废，任务正常结束
            conn.close()

    def accept(self: Any, listener: socket.socket) -> asyncio.Future:
        self._register_with_iocp(listener)
        conn = self._get_accept_socket(listener.family)
        ov = _overlapped.Overlapped(NULL)
        ov.AcceptEx(listener.fileno(), conn.fileno())

        def finish_accept(trans: Any, key: int, ov: Any) -> tuple[socket.socket, Any]:
            ov.getresult()
            # Use SO_UPDATE_ACCEPT_CONTEXT so getsockname() etc work.
            buf = struct.pack("@P", listener.fileno())
            conn.setsockopt(socket.SOL_SOCKET,
                            _overlapped.SO_UPDATE_ACCEPT_CONTEXT, buf)
            conn.settimeout(listener.gettimeout())
            return conn, conn.getpeername()

        future = self._register(ov, listener, finish_accept)
        coro = accept_coro(future, conn)
        asyncio.tasks.ensure_future(coro, loop=self._loop)
        return future

    windows_events.IocpProactor.accept = accept
    return True


def install_proactor_accept_patch() -> bool:
    """安装 Proactor accept 加固补丁（仅 Windows；幂等）。返回是否生效。"""
    global _accept_patch_installed
    if _accept_patch_installed:
        return True
    if sys.platform != "win32":
        return False
    try:
        from asyncio import proactor_events
    except ImportError:
        return False
    ok_start = False
    if _source_has(proactor_events.BaseProactorEventLoop._start_serving, _ACCEPT_MARKER):
        try:
            _patch_start_serving(proactor_events.BaseProactorEventLoop)
            ok_start = True
        except Exception as exc:  # noqa: BLE001 补丁失败不影响启动
            logger.warning("Proactor accept 加固补丁（_start_serving）安装失败，已跳过：%s", exc)
    ok_accept = _patch_proactor_accept()
    if ok_start or ok_accept:
        _accept_patch_installed = True
        logger.info("Proactor accept 加固已生效（_start_serving=%s, accept_coro=%s）", ok_start, ok_accept)
    else:
        logger.warning("Proactor accept 加固跳过：当前 Python 的 asyncio 实现与补丁预期不符（不影响限流与异常过滤器）")
    return ok_start or ok_accept
