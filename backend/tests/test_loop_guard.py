"""事件循环异常过滤器 + Proactor accept 加固测试（L2 门禁，《后端API设计.md》§11.12）。"""
from __future__ import annotations

import asyncio
import socket
import sys

import pytest

from app.core.loop_guard import install_loop_guard, install_proactor_accept_patch, is_benign_connection_lost


class _FakeHandle:
    """模拟 asyncio Handle：repr 含回调名（真实日志形如 <Handle _ProactorBasePipeTransport._call_connection_lost()>）。"""

    def __repr__(self) -> str:
        return "<Handle _ProactorBasePipeTransport._call_connection_lost()>"


def _context(exc: BaseException, handle: object | None = None, message: str = "Exception in callback _ProactorBasePipeTransport._call_connection_lost()") -> dict:
    return {"message": message, "exception": exc, "handle": _FakeHandle() if handle is None else handle}


# ---------- 过滤器判定 ----------

def test_benign_connection_reset_recognized() -> None:
    assert is_benign_connection_lost(_context(ConnectionResetError(10054, "远程主机强迫关闭了一个现有的连接。"))) is True


def test_benign_connection_aborted_recognized() -> None:
    assert is_benign_connection_lost(_context(ConnectionAbortedError(10053, "远程主机强迫终止了一个现有的连接。"))) is True


def test_benign_netname_deleted_recognized() -> None:
    assert is_benign_connection_lost(_context(OSError(64, "指定的网络名不再可用。"))) is True


def test_unrelated_exceptions_not_filtered() -> None:
    assert is_benign_connection_lost(_context(ValueError("boom"))) is False  # 非 OSError
    assert is_benign_connection_lost(_context(OSError(10013, "permission denied"))) is False  # 非良性 errno
    # errno 正确但非连接关闭回调（handle 缺失且消息不匹配）
    assert is_benign_connection_lost({"message": "boom", "exception": ConnectionResetError(10054, "x")}) is False


def test_install_filters_benign_and_chains_rest() -> None:
    loop = asyncio.new_event_loop()
    try:
        reported: list[dict] = []

        def previous(l: asyncio.AbstractEventLoop, ctx: dict) -> None:
            reported.append(ctx)

        loop.set_exception_handler(previous)
        install_loop_guard(loop)
        loop.call_exception_handler(_context(ConnectionResetError(10054, "reset")))
        assert reported == []  # 良性：静默不转发
        loop.call_exception_handler(_context(ValueError("boom")))
        assert len(reported) == 1  # 非良性：链到原处理器
        assert reported[0]["exception"].__class__ is ValueError
    finally:
        loop.close()


def test_install_default_handler_fallback() -> None:
    # 原处理器为 None 时回退 default_exception_handler（良性异常不抛错、无输出）
    loop = asyncio.new_event_loop()
    try:
        install_loop_guard(loop)
        loop.call_exception_handler(_context(ConnectionResetError(10054, "reset")))
    finally:
        loop.close()


# ---------- Proactor accept 加固 ----------

@pytest.mark.skipif(sys.platform != "win32", reason="仅 Windows Proactor 场景存在该 stdlib 缺陷")
def test_accept_patch_installs_idempotent() -> None:
    assert install_proactor_accept_patch() is True
    assert install_proactor_accept_patch() is True  # 幂等


@pytest.mark.skipif(sys.platform != "win32", reason="仅 Windows Proactor 场景存在该 stdlib 缺陷")
def test_accept_patch_server_survives_aborted_connections() -> None:
    """RST 暴力断连后：监听 socket 存活、可接受新连接，良性 accept 错误不再上报。

    未打补丁时 stdlib 会在首次良性 accept 失败后关闭监听 socket（服务停止接受新连接），
    本用例断言补丁生效后监听器在同类攻击下保持可用。
    """
    install_proactor_accept_patch()

    async def run() -> None:
        loop = asyncio.get_running_loop()
        reported: list[dict] = []
        loop.set_exception_handler(lambda l, ctx: reported.append(ctx))

        # 1) 裸 socket 建立一批连接并立即 RST 作废（连接留在 accept 队列但已死亡）
        lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lsock.bind(("127.0.0.1", 0))
        lsock.listen(128)
        port = lsock.getsockname()[1]
        victims = []
        for _ in range(20):
            s = socket.create_connection(("127.0.0.1", port), timeout=2)
            victims.append(s)
        for s in victims:
            # SO_LINGER(1, 0)：关闭时立即发 RST，连接作废
            s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b"\x01\x00\x00\x00\x00\x00\x00\x00")
            s.close()

        # 2) asyncio 接管监听：首个 AcceptEx 命中已死亡连接 → 良性 accept 错误（补丁应静默重挂）
        class _Proto(asyncio.Protocol):
            def connection_made(self, transport) -> None:  # type: ignore[override]
                transport.close()

        server = await loop.create_server(_Proto, sock=lsock)
        await asyncio.sleep(0.4)  # 等待首次 accept 失败 + 50ms 退避重挂完成

        # 3) 关键断言：监听器仍存活，新连接可正常建立
        r, w = await asyncio.open_connection("127.0.0.1", port)
        w.close()
        await w.wait_closed()

        server.close()
        await server.wait_closed()

        # 4) 良性 accept 错误不应上报到异常处理器（补丁静默重挂，无 ERROR 噪音）
        assert all(
            "Accept failed" not in c.get("message", "") and "Task exception" not in c.get("message", "")
            for c in reported
        ), reported

    asyncio.run(run())
