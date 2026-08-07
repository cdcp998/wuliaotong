"""Redis 缓存基础设施：cache-aside 工具 + 优雅降级。

设计原则（《开发规范.md》§4 一致性优先）：
- Redis 是加速层，MySQL 始终是事实来源；缓存丢失/Redis 不可用时直接回源查库。
- 所有缓存操作失败均静默降级（记录 debug 日志），绝不向请求路径抛异常。
- key 统一前缀 ``wlt:``，按数据类型分段，便于批量失效与排障。
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable

from fastapi.encoders import jsonable_encoder
from redis import Redis
from redis.exceptions import RedisError

from app.config import settings

logger = logging.getLogger("app.cache")

KEY_PREFIX = "wlt:"

_client: Redis | None = None
_client_broken = False  # 连接失败后短路，避免每个请求都重试建连


def _get_client() -> Redis | None:
    """惰性创建全局 Redis 客户端；失败返回 None（调用方走降级路径）。"""
    global _client, _client_broken
    if _client is not None:
        return _client
    if _client_broken:
        return None
    try:
        # protocol=2：兼容 Redis 5.x（默认 RESP3 的 HELLO 命令 Redis6+ 才有）
        _client = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            protocol=2,
            socket_timeout=0.5,
            socket_connect_timeout=0.5,
        )
        _client.ping()
        logger.info("Redis 连接成功：%s", settings.redis_url)
        return _client
    except Exception as exc:  # noqa: BLE001 缓存不可用不影响业务
        # 关键：Redis.from_url 是惰性连接，ping 失败时 _client 已非 None；
        # 必须清空，否则短路标志永远不生效，每个请求都会再等一次连接超时
        _client = None
        _client_broken = True
        logger.warning("Redis 不可用，缓存降级为直查数据库：%s", exc)
        return None


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
    except RedisError:
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
    except (RedisError, ValueError) as exc:  # noqa: BLE001
        logger.debug("cache_get %s 失败：%s", name, exc)
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
    except (RedisError, TypeError) as exc:  # noqa: BLE001
        logger.debug("cache_set %s 失败：%s", name, exc)


def cache_delete(*names: str) -> None:
    """删除一个或多个缓存 key；失败静默。"""
    c = _get_client()
    if c is None or not names:
        return
    try:
        c.delete(*[_k(n) for n in names])
    except RedisError as exc:  # noqa: BLE001
        logger.debug("cache_delete 失败：%s", exc)


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
        logger.debug("cache_delete_pattern %s 失败：%s", patterns, exc)


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


def session_get(token: str) -> int | None:
    """按会话令牌取 user_id；未命中/过期返回 None。"""
    v = cache_get(session_key(token))
    return v if isinstance(v, int) else None


def session_set(token: str, user_id: int, ttl: int) -> None:
    """登录/回填时写入会话（Redis 原生 TTL 负责过期）。

    同时把 token 记入 ``user_sessions:{user_id}`` 集合（改密/重置时批量失效用）。
    """
    c = _get_client()
    if c is None:
        return
    try:
        c.set(_k(session_key(token)), user_id, ex=ttl)
        c.sadd(_k(user_sessions_key(user_id)), token)
        c.expire(_k(user_sessions_key(user_id)), ttl)
    except RedisError as exc:  # noqa: BLE001
        logger.debug("session_set 失败：%s", exc)


def session_delete(token: str) -> None:
    cache_delete(session_key(token))


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
            c.delete(*[_k(session_key(t)) for t in tokens])
        c.delete(_k(user_sessions_key(user_id)))
    except RedisError as exc:  # noqa: BLE001
        logger.debug("session_delete_all 失败：%s", exc)


def session_renew(token: str, ttl: int) -> None:
    """滑动续期：剩余不足一半时刷新 TTL（与 deps.resolve_session_user 原逻辑对齐）。"""
    c = _get_client()
    if c is None:
        return
    try:
        remain = c.ttl(_k(session_key(token)))
        if 0 < remain < ttl / 2:
            c.expire(_k(session_key(token)), ttl)
    except RedisError as exc:  # noqa: BLE001
        logger.debug("session_renew 失败：%s", exc)
