"""操作日志字段级变更采集（audit diff）。

原理：SQLAlchemy ``before_flush`` 事件钩子捕获本次事务中所有「脏对象」的
字段级 old/new（含新增/删除对象），写入当前请求的 ContextVar 容器；
审计中间件在响应后取出，写入 sys_operation_log.diff（JSON）。

- 全局生效、零端点侵入（核心与插件模块的写操作自动覆盖）；
- ContextVar 容器为可变 dict：父任务（中间件）set，子任务（handler 内 flush）
  继承可见并写入同一引用，天然按请求隔离、并发安全；
- 敏感字段（password/token/secret 等）值打码 ******；password_hash 直接剔除；
- datetime/Decimal/bytes 等统一序列化为可读字符串。

diff 结构：
{
  "tables": {
    "sys_user": {
      "pk": "1",
      "op": "update",            # update | insert | delete
      "fields": { "real_name": {"old": "张三", "new": "李四"}, ... }
    }
  }
}
"""
from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import event, inspect as sa_inspect

logger = logging.getLogger("app.audit.diff")

_AUDIT_DIFF_MAX_CHARS = 8000          # 单条日志 diff 上限
_VALUE_MAX_CHARS = 500                # 单值序列化上限
_SENSITIVE_KEYS = ("password", "passwd", "secret", "token", "captcha")
_SKIP_COLUMNS = {"password_hash"}     # 完全不采集的列
_SKIP_TABLES = {"sys_session", "sys_operation_log"}  # 会话/日志自身不采集（噪音过滤）

# 每请求一个 holder dict（{"diff": str}）；None=当前上下文无请求捕获
_holder: ContextVar[dict | None] = ContextVar("audit_diff_holder", default=None)


def begin_request_capture():
    """中间件进入时调用：开启本请求的 diff 捕获，返回 token 供 end 复位。"""
    h: dict = {}
    token = _holder.set(h)
    return token


def end_request_capture(token) -> str:
    """中间件响应后调用：复位上下文并返回本次请求的字段级变更 JSON（可为空串）。"""
    h = _holder.get()
    _holder.reset(token)
    if isinstance(h, dict):
        return h.get("diff", "")
    return ""


def _serialize(v) -> str | None:
    """字段值 → 可读字符串（None 保持 None 表示空/未设置）。"""
    if v is None:
        return None
    if isinstance(v, bool):
        return "是" if v else "否"
    if isinstance(v, (datetime, date)):
        return v.isoformat(sep=" ", timespec="seconds") if isinstance(v, datetime) else v.isoformat()
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, bytes):
        return f"<二进制 {len(v)}B>"
    return str(v)[:_VALUE_MAX_CHARS]


def _capture_session(session) -> dict:
    """提取 session 中脏/新增/删除对象的字段级变更。"""
    tables: dict[str, dict] = {}

    def record(obj, op: str, fields: dict) -> None:
        try:
            mapper = sa_inspect(obj).mapper
            table = obj.__tablename__
            if table in _SKIP_TABLES:
                return
            pk = ""
            for c in mapper.primary_key:
                pk = str(getattr(obj, c.key, "") or "")
            entry = tables.setdefault(table, {"pk": pk, "op": op, "fields": {}})
            for col, pair in fields.items():
                if col in _SKIP_COLUMNS or col in ("created_at", "updated_at"):
                    continue
                low = col.lower()
                o, n = pair
                if low.endswith(("_id",)) and o == n:
                    continue
                if any(s in low for s in _SENSITIVE_KEYS):
                    masked_old = "******" if o not in (None, "") else o
                    masked_new = "******" if n not in (None, "") else n
                    entry["fields"][col] = {"old": masked_old, "new": masked_new}
                    continue
                if o == n:
                    continue
                entry["fields"][col] = {"old": o, "new": n}
            if not entry["fields"]:
                tables.pop(table, None)
        except Exception as exc:  # noqa: BLE001 单对象失败不影响其余采集
            logger.debug("diff capture skip %s: %s", type(obj).__name__, exc)

    for obj in session.new:
        mapper = sa_inspect(obj).mapper
        fields = {}
        for attr in mapper.column_attrs:
            fields[attr.key] = (None, _serialize(getattr(obj, attr.key)))
        if fields:
            record(obj, "insert", fields)

    for obj in session.deleted:
        mapper = sa_inspect(obj).mapper
        fields = {}
        for attr in mapper.column_attrs:
            fields[attr.key] = (_serialize(getattr(obj, attr.key)), None)
        if fields:
            record(obj, "delete", fields)

    for obj in session.dirty:
        if not session.is_modified(obj):
            continue
        state = sa_inspect(obj)
        fields = {}
        for attr in state.mapper.column_attrs:
            hist = state.attrs[attr.key].history
            if not hist.has_changes():
                continue
            old_v = hist.deleted[0] if hist.deleted else None
            new_v = hist.added[0] if hist.added else None
            fields[attr.key] = (_serialize(old_v), _serialize(new_v))
        if fields:
            record(obj, "update", fields)

    return tables


def _before_flush(session, flush_context, instances) -> None:  # noqa: ARG001
    """SQLAlchemy before_flush：把变更快照写入当前请求的 holder。"""
    h = _holder.get()
    if h is None:
        return
    try:
        changes = _capture_session(session)
        if changes:
            existing = h.get("tables") or {}
            existing.update(changes)
            text = json.dumps({"tables": existing}, ensure_ascii=False, default=str)
            if len(text) > _AUDIT_DIFF_MAX_CHARS:
                text = text[:_AUDIT_DIFF_MAX_CHARS]
            h["tables"] = existing
            h["diff"] = text
    except Exception as exc:  # noqa: BLE001 采集失败不影响业务事务
        logger.warning("audit diff 采集失败：%s", exc)


def install_audit_diff_listeners() -> None:
    """注册全局 Session 事件监听（在 app 启动时调用一次）。"""
    from app.db import SessionLocal

    event.listen(SessionLocal, "before_flush", _before_flush)
