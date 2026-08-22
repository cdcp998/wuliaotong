"""Redis 缓存基础设施：cache-aside 工具 + 优雅降级。

设计原则（《开发规范.md》§4 一致性优先）：
- Redis 是加速层，MySQL 始终是事实来源；缓存丢失/Redis 不可用时直接回源查库。
- 所有缓存操作失败均静默降级（记录 debug 日志），绝不向请求路径抛异常。
- key 统一前缀 ``wlt:``，按数据类型分段，便于批量失效与排障。
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Callable

from fastapi.encoders import jsonable_encoder
from redis import Redis
from redis.exceptions import RedisError

from app.config import settings

logger = logging.getLogger("app.cache")

KEY_PREFIX = "wlt:"

_client: Redis | None = None
_client_broken = False  # 故障短路：窗口内不再逐请求重试建连
_retry_at = 0.0  # 下次允许自动重连的时间（monotonic 秒）
_state_lock = threading.Lock()  # 保护 _client/_client_broken/_retry_at
_last_broken_log = 0.0  # 故障日志节流（monotonic 秒）


def _mark_broken(exc: Exception) -> None:
    """运行中 Redis 操作失败：进入故障退避状态，丢弃旧连接池，等待自动重连。

    所有业务操作捕获 RedisError 后调用本函数，保证「Redis 宕机 → 快速降级直查数据库
    → 退避窗口后自动重试重连」闭环，无需人工重启；多线程并发失败只处理一次。
    """
    global _client, _client_broken, _retry_at, _last_broken_log
    now = time.monotonic()
    old = None
    with _state_lock:
        if _client is None and _client_broken and now < _retry_at:
            return  # 已在退避窗口内，保持现状
        old = _client
        _client = None
        _client_broken = True
        _retry_at = now + settings.redis_retry_seconds
    if old is not None:
        try:
            old.close()
        except Exception:  # noqa: BLE001 关闭旧连接池失败不影响降级
            pass
    if now - _last_broken_log >= 60:
        _last_broken_log = now
        logger.warning("Redis 操作失败，缓存降级为直查数据库（%.0fs 后自动重试）：%s", settings.redis_retry_seconds, exc)


def _get_client() -> Redis | None:
    """惰性创建全局 Redis 客户端；失败进入退避窗口，到期自动重试（自治愈）。

    退避期间调用方直接走降级路径（返回 None），不会每个请求都等待建连超时。
    """
    global _client, _client_broken, _retry_at, _last_broken_log
    if _client is not None:
        return _client
    now = time.monotonic()
    with _state_lock:
        if _client is not None:
            return _client
        if _client_broken and now < _retry_at:
            return None
        client = None
        try:
            # protocol=2：兼容 Redis 5.x（默认 RESP3 的 HELLO 命令 Redis6+ 才有）
            client = Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                protocol=2,
                socket_timeout=0.5,
                socket_connect_timeout=0.5,
            )
            client.ping()
            _client = client
            _client_broken = False
            _retry_at = 0.0
            logger.info("Redis 连接成功：%s", settings.redis_url)
            return _client
        except Exception as exc:  # noqa: BLE001 缓存不可用不影响业务
            # 关键：Redis.from_url 是惰性连接，ping 失败时 client 已非 None；
            # 必须清空并关闭，否则后续请求会重复等待连接超时
            _client = None
            _client_broken = True
            _retry_at = time.monotonic() + settings.redis_retry_seconds
            if client is not None:
                try:
                    client.close()
                except Exception:  # noqa: BLE001
                    pass
            if now - _last_broken_log >= 60:
                _last_broken_log = time.monotonic()
                logger.warning("Redis 不可用，缓存降级为直查数据库（%.0fs 后自动重试）：%s", settings.redis_retry_seconds, exc)
            return None


def reset_client() -> None:
    """立即重置 Redis 客户端（初始化热切换 / 管理后台重连 / 测试隔离时调用）。

    调用后下一次缓存操作会立刻尝试连接新配置；即使 Redis 当时不可用，
    后续也会按退避窗口自动重试（自治愈）。
    """
    global _client, _client_broken, _retry_at
    with _state_lock:
        old = _client
        _client = None
        _client_broken = False
        _retry_at = 0.0
    if old is not None:
        try:
            old.close()
        except Exception:  # noqa: BLE001 关闭旧连接池失败不影响新连接
            pass


def _k(name: str) -> str:
    return f"{KEY_PREFIX}{name}"


def is_available() -> bool:
    return _get_client() is not None


def ping() -> bool:
    """健康检查（管理后台/启动自检用）。"""
    c = _get_client()
    if c is None:
        return False
    try:
        return bool(c.ping())
    except RedisError as exc:
        _mark_broken(exc)
        return False


def cache_get(name: str) -> Any | None:
    """读取 JSON 缓存；未命中/解析失败/Redis 异常均返回 None。"""
    c = _get_client()
    if c is None:
        return None
    try:
        raw = c.get(_k(name))
        if raw is None:
            return None
        return json.loads(raw)
    except RedisError as exc:  # noqa: BLE001
        _mark_broken(exc)
        return None
    except ValueError as exc:  # noqa: BLE001 缓存内容解析失败按未命中处理
        logger.debug("cache_get %s 解析失败：%s", name, exc)
        return None


def cache_set(name: str, value: Any, ttl: int) -> None:
    """写入 JSON 缓存（ttl 秒）；失败静默。

    用 jsonable_encoder 归一化（Decimal→float、datetime→str），
    与 FastAPI 真实响应序列化一致，保证缓存命中/未命中返回类型相同。
    """
    c = _get_client()
    if c is None:
        return
    try:
        c.set(_k(name), json.dumps(jsonable_encoder(value), ensure_ascii=False, default=str), ex=ttl)
    except RedisError as exc:  # noqa: BLE001
        _mark_broken(exc)
    except TypeError as exc:  # noqa: BLE001 序列化失败不标记连接故障
        logger.debug("cache_set %s 序列化失败：%s", name, exc)


def cache_delete(*names: str) -> None:
    """删除一个或多个缓存 key；失败静默。"""
    c = _get_client()
    if c is None or not names:
        return
    try:
        c.delete(*[_k(n) for n in names])
    except RedisError as exc:  # noqa: BLE001
        _mark_broken(exc)


def cache_delete_pattern(*patterns: str) -> None:
    """按模式删除缓存（如 ``dict:categories*``）；用 SCAN 避免 KEYS 阻塞。"""
    c = _get_client()
    if c is None or not patterns:
        return
    try:
        keys = [k for pat in patterns for k in c.scan_iter(match=_k(pat), count=200)]
        if keys:
            c.delete(*keys)
    except RedisError as exc:  # noqa: BLE001
        _mark_broken(exc)


def cache_aside(name: str, ttl: int, loader: Callable[[], Any]) -> Any:
    """cache-aside 读路径：缓存命中直接返回；未命中调 loader 回源并回填。

    Redis 不可用时直接返回 loader() 结果，业务无感。
    """
    cached = cache_get(name)
    if cached is not None:
        return cached
    value = loader()
    if value is not None:
        cache_set(name, value, ttl)
    return value


def cache_aside_json(name: str, ttl: int, loader: Callable[[], Any]) -> Any:
    """与 cache_aside 相同，但以 API 响应体（含业务状态码）为单位缓存。

    用于看板聚合等重查询：缓存的是 ok(...) 的完整 dict，命中时无需再序列化。
    """
    cached = cache_get(name)
    if cached is not None:
        return cached
    value = loader()
    if value is not None:
        cache_set(name, value, ttl)
    return value


# ============================ Session（T0 热路径） ============================


def session_key(token: str) -> str:
    return f"session:{token}"


def session_meta_key(token: str) -> str:
    """会话元数据 key：存登录时的总会话时长（秒），供 Redis 快路径滑动续期使用。

    「记住登录状态」会话（如 30 天）与普通会话（如 8 小时）的总时长不同，
    续期阈值必须按总时长计算，不能复用固定的 _SESSION_TTL，否则 Redis 重启回填后
    30 天会话会被缩短为 8 小时。
    """
    return f"session_meta:{token}"


def session_get(token: str) -> int | None:
    """按会话令牌取 user_id；未命中/过期返回 None。"""
    v = cache_get(session_key(token))
    return v if isinstance(v, int) else None


def session_set(token: str, user_id: int, ttl: int, total_ttl: int | None = None) -> None:
    """登录/回填时写入会话（Redis 原生 TTL 负责过期）。

    total_ttl 为登录时的会话总时长（秒），写入独立 meta key 供快路径滑动续期计算阈值；
    缺省时 meta 不写（兼容旧调用），续期回退到默认总时长。
    同时把 token 记入 ``user_sessions:{user_id}`` 集合（改密/重置时批量失效用）。
    """
    c = _get_client()
    if c is None:
        return
    try:
        c.set(_k(session_key(token)), user_id, ex=ttl)
        if total_ttl and total_ttl > 0:
            c.set(_k(session_meta_key(token)), total_ttl, ex=total_ttl)
        c.sadd(_k(user_sessions_key(user_id)), token)
        c.expire(_k(user_sessions_key(user_id)), ttl)
    except RedisError as exc:  # noqa: BLE001
        _mark_broken(exc)


def session_delete(token: str) -> None:
    cache_delete(session_key(token), session_meta_key(token))


def user_sessions_key(user_id: int) -> str:
    return f"user_sessions:{user_id}"


def session_delete_all(user_id: int) -> None:
    """删除某用户全部会话（改密/重置密码后使其他会话失效），与 MySQL 语义一致。"""
    c = _get_client()
    if c is None:
        return
    try:
        tokens = c.smembers(_k(user_sessions_key(user_id)))
        if tokens:
            keys = [_k(session_key(t)) for t in tokens] + [_k(session_meta_key(t)) for t in tokens]
            c.delete(*keys)
        c.delete(_k(user_sessions_key(user_id)))
    except RedisError as exc:  # noqa: BLE001
        _mark_broken(exc)


def session_renew(token: str, default_ttl: int | None = None) -> None:
    """滑动续期：剩余不足总会话时长一半时刷新 TTL。

    总时长优先读 meta key（登录时写入），保证「记住登录状态」会话在 Redis 快路径续期时
    不被普通会话默认时长（8 小时）覆盖；旧会话无 meta 时回退 default_ttl /
    SESSION_EXPIRE_HOURS，保持向后兼容。
    """
    c = _get_client()
    if c is None:
        return
    try:
        key = _k(session_key(token))
        remain = c.ttl(key)
        if remain <= 0:
            return  # key 不存在或未设置 TTL：不续期
        total = default_ttl
        raw = c.get(_k(session_meta_key(token)))
        if raw:
            try:
                meta = int(json.loads(raw))
                if meta > 0:
                    total = meta
            except (TypeError, ValueError):
                pass
        if total is None:
            total = int(float(settings.session_expire_hours) * 3600)
        if total <= 0:
            return
        if remain < total / 2:
            c.expire(key, int(total))
            c.expire(_k(session_meta_key(token)), int(total))
    except RedisError as exc:  # noqa: BLE001
        _mark_broken(exc)
