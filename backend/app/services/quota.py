"""大模型/OCR 服务商配额管理（系统设置 → OCR 与大模型 → 配额与预警）。

- 获取配额：SiliconFlow /user/info（余额，元）、DeepSeek /user/balance（余额，元）、
  豆包(火山方舟) /usage/quota（资源包配额，字段随服务商返回而变，防御式解析）
- 快照：成功/失败结果统一存 sys_config(quota.snapshot) JSON，设置页展示「上次获取」
- 预警：check_quota_warnings 由调度器每小时调用；剩余配额低于阈值（quota.warning.threshold.*）
  时向收件人（quota.warning.recipients）发送邮件；每个服务商只在跌破阈值时通知一次，
  恢复（回到阈值以上）后清除标记，再次跌破可再通知。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.sys import SysConfig
from app.services.mail import send_mail

logger = logging.getLogger("app.quota")

PROVIDERS = ("siliconflow", "deepseek", "doubao")

PROVIDER_LABELS = {
    "siliconflow": "视觉模型（SiliconFlow）",
    "deepseek": "文本模型（DeepSeek）",
    "doubao": "豆包视觉模型（兜底）",
}

# 模型参与的工作任务（与代码调用点保持一致；主用=优先调用，备用=主用不可用时兜底）
SCENE_META = {
    "vision_product": {"label": "拍照识别商品", "desc": "拍摄外包装/标签识别材料（本地 OCR 未命中时）"},
    "vision_text": {"label": "视觉文字兜底", "desc": "本地 OCR 未识别出文本时的纯视觉识别兜底"},
    "vision_delivery": {"label": "送货单识别", "desc": "送货单拍照 → 识别并结构化材料明细"},
    "match_vision": {"label": "送货单参考匹配", "desc": "识别未命中时用视觉模型补充参考信息"},
    "classify_items": {"label": "材料自动分类", "desc": "按名称/规格判断系统分类"},
    "structured": {"label": "送货单结构化", "desc": "提取供应商/单号/明细 JSON"},
    "ocr_correct": {"label": "OCR 文本纠错", "desc": "对本地识别文本做纠错"},
}

MODEL_SCENES: dict[str, list[tuple[str, str]]] = {
    "siliconflow": [
        ("vision_delivery", "主用"),
        ("vision_product", "主用"),
        ("vision_text", "主用"),
        ("match_vision", "备用"),
    ],
    "doubao": [
        ("match_vision", "主用"),
        ("vision_product", "备用"),
        ("vision_text", "备用"),
    ],
    "deepseek": [
        ("ocr_correct", "主用"),
        ("classify_items", "主用"),
        ("structured", "主用"),
    ],
}

SNAPSHOT_KEY = "quota.snapshot"
NOTIFIED_PREFIX = "quota.warning.notified."
LAST_REFRESH_KEY = "quota.last_refresh"
DEFAULT_INTERVAL_MINUTES = 60


def _cfg(db: Session, key: str, default: str = "") -> str:
    row = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    return row.config_value if row and row.config_value else default


def _set_cfg(db: Session, key: str, value: str) -> None:
    row = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    if row is None:
        db.add(SysConfig(config_key=key, config_value=value, remark="配额管理"))
    else:
        row.config_value = value


def _num(v) -> float | None:
    """宽松数值解析：字符串/整数/浮点 → float；空/非法 → None。"""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _http_get(url: str, api_key: str, timeout: float = 15.0) -> httpx.Response:
    """模块级请求入口（便于测试替换）。"""
    return httpx.get(url, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout)


def _http_error_text(exc: httpx.HTTPError, resp_text: str = "") -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        hint = {400: "请求参数错误", 401: "API Key 无效或已过期", 403: "无权限访问", 404: "接口不存在", 429: "请求过于频繁"}.get(status, "")
        return f"HTTP {status}{'：' + hint if hint else ''}"
    return f"{exc.__class__.__name__}: {exc}"


def _status_text(status: str | None) -> str | None:
    """服务商状态 → 可读中文；SiliconFlow 返回 normal/active 等英文枚举，统一映射。"""
    if not status:
        return None
    mapping = {
        "normal": "余额可用", "active": "余额可用", "ok": "余额可用",
        "frozen": "账户冻结", "inactive": "账户未激活", "unreal_name": "未实名认证",
        "欠费": "欠费", "欠费停服": "欠费停服", "正常": "正常", "开通中": "开通中",
    }
    return mapping.get(str(status).lower(), str(status))


def _fetch_siliconflow(base_url: str, api_key: str) -> list[dict]:
    """SiliconFlow 用户信息：data.totalBalance（元，含赠送+充值）。"""
    resp = _http_get(f"{base_url.rstrip('/')}/user/info", api_key)
    resp.raise_for_status()
    body = resp.json()
    data = body.get("data") if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        data = {}
    balance = _num(data.get("totalBalance") or data.get("total_balance") or data.get("balance"))
    if balance is None:
        raise ValueError("接口返回格式异常：未找到余额字段 totalBalance")
    return [{
        "name": "账户余额",
        "value": balance,
        "unit": "元",
        "remaining": balance,
        "status": _status_text(data.get("status")),
    }]


def _fetch_deepseek(base_url: str, api_key: str) -> list[dict]:
    """DeepSeek 余额：balance_infos[].total_balance（优先 CNY，元）。"""
    resp = _http_get(f"{base_url.rstrip('/')}/user/balance", api_key)
    resp.raise_for_status()
    body = resp.json()
    infos = body.get("balance_infos") if isinstance(body, dict) else None
    infos = infos or []
    item = next((i for i in infos if str(i.get("currency", "")).upper() == "CNY"), None) or (infos[0] if infos else {})
    balance = _num(item.get("total_balance"))
    if balance is None:
        raise ValueError("接口返回格式异常：未找到余额字段 total_balance")
    return [{
        "name": "账户余额（CNY）",
        "value": balance,
        "unit": "元",
        "remaining": balance,
        "status": "余额可用" if body.get("is_available") is not False else "余额不足",
    }]


def _fetch_doubao(base_url: str, api_key: str) -> list[dict]:
    """豆包（火山方舟）资源配额：quota_list[]，防御式解析 total/used/remaining_quota。"""
    resp = _http_get(f"{base_url.rstrip('/')}/usage/quota", api_key)
    resp.raise_for_status()
    body = resp.json()
    quota_list = body.get("quota_list") if isinstance(body, dict) else None
    if isinstance(quota_list, dict):  # 兼容 {data: [...]} 包裹
        quota_list = quota_list.get("data")
    quota_list = quota_list or []
    items: list[dict] = []
    for q in quota_list:
        if not isinstance(q, dict):
            continue
        ref = q.get("model_reference") or {}
        name = q.get("name") or (ref.get("id") if isinstance(ref, dict) else None) or q.get("id") or "资源包"
        total = _num(q.get("total"))
        used = _num(q.get("used"))
        remaining = _num(q.get("remaining_quota") or q.get("remaining"))
        if remaining is None and total is not None and used is not None:
            remaining = round(total - used, 2)
        status = q.get("status")
        items.append({
            "name": str(name),
            "value": remaining,
            "unit": str(q.get("unit")) if q.get("unit") else "额度",
            "remaining": remaining,
            "status": str(status) if status is not None else None,
        })
    if not items:
        raise ValueError("接口未返回配额数据（可能未开通资源包或接口格式已变化）")
    return items


_FETCHERS = {
    "siliconflow": _fetch_siliconflow,
    "deepseek": _fetch_deepseek,
    "doubao": _fetch_doubao,
}

_DEFAULT_BASE_URLS = {
    "siliconflow": "https://api.siliconflow.cn/v1",
    "deepseek": "https://api.deepseek.com",
    "doubao": "https://ark.cn-beijing.volces.com/api/v3",
}

# 提供官方余额/配额查询接口的服务商域名（其余 OpenAI 兼容服务商可正常用于识别，但无配额接口）
_KNOWN_QUOTA_HOSTS = {
    "siliconflow": ("api.siliconflow.cn",),
    "deepseek": ("api.deepseek.com",),
    "doubao": ("ark.cn-beijing.volces.com",),
}

QUOTA_UNAVAILABLE_MSG = (
    "该服务商不提供标准的余额/配额查询接口。配额查询仅支持 SiliconFlow、DeepSeek、火山方舟（豆包）"
    "等提供官方余额接口的服务商；其他 OpenAI 兼容服务商（自建 vLLM/Ollama/第三方网关等）"
    "可正常用于识别，但无法获取配额，也不会参与配额告警。"
)


def _quota_provider_of(base_url: str) -> str | None:
    """按 Base URL 域名识别可提供官方配额接口的服务商；自建/第三方网关返回 None。"""
    host = (base_url or "").lower()
    for provider, hosts in _KNOWN_QUOTA_HOSTS.items():
        if any(h in host for h in hosts):
            return provider
    return None


def fetch_provider_quota(db: Session, provider: str) -> dict:
    """从服务商获取配额/余额；任何错误都返回 ok=False + 可读 error（不抛异常）。

    模型未启用（llm.*.enabled == \"0\"）或未配置 API Key 时不查询服务商，直接返回提示。
    """
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if provider not in _FETCHERS:
        return {"provider": provider, "ok": False, "fetched_at": now, "error": f"未知服务商: {provider}"}
    if _cfg(db, f"llm.{provider}.enabled") == "0":
        return {"provider": provider, "ok": False, "fetched_at": now, "error": "模型未启用，未查询配额（请先在设置中启用并保存）"}
    api_key = _cfg(db, f"llm.{provider}.api_key")
    if not api_key:
        return {"provider": provider, "ok": False, "fetched_at": now, "error": "未配置 API Key（请先在设置中填写并保存）"}
    base_url = _cfg(db, f"llm.{provider}.base_url") or _DEFAULT_BASE_URLS[provider]
    # 自选/自建服务商（非官方域名）无标准余额接口：明确说明兼容性，不发起请求
    if _quota_provider_of(base_url) is None:
        return {"provider": provider, "ok": False, "fetched_at": now, "error": QUOTA_UNAVAILABLE_MSG}
    try:
        items = _FETCHERS[provider](base_url, api_key)
        return {"provider": provider, "ok": True, "fetched_at": now, "items": items}
    except httpx.HTTPError as exc:
        return {"provider": provider, "ok": False, "fetched_at": now, "error": f"请求失败：{_http_error_text(exc)}"}
    except Exception as exc:  # noqa: BLE001 解析/网络等任何异常都优雅降级
        return {"provider": provider, "ok": False, "fetched_at": now, "error": f"获取失败：{exc}"}


def _drop_quota_snapshot(db: Session, provider: str) -> None:
    """从快照中移除某服务商（未启用/未配置 Key 时不展示过期配额）。"""
    raw = _cfg(db, SNAPSHOT_KEY)
    try:
        snap = json.loads(raw) if raw else {}
        if not isinstance(snap, dict) or provider not in snap:
            return
    except json.JSONDecodeError:
        return
    del snap[provider]
    _set_cfg(db, SNAPSHOT_KEY, json.dumps(snap, ensure_ascii=False))
    db.commit()


def save_quota_snapshot(db: Session, provider: str, payload: dict) -> None:
    """把单次获取结果合并写入 quota.snapshot（JSON），立即提交。"""
    raw = _cfg(db, SNAPSHOT_KEY)
    try:
        snap = json.loads(raw) if raw else {}
        if not isinstance(snap, dict):
            snap = {}
    except json.JSONDecodeError:
        snap = {}
    snap[provider] = payload
    _set_cfg(db, SNAPSHOT_KEY, json.dumps(snap, ensure_ascii=False))
    db.commit()


def get_quota_snapshot(db: Session) -> dict:
    """读取最近一次获取结果（未获取过的服务商缺省）。"""
    raw = _cfg(db, SNAPSHOT_KEY)
    try:
        snap = json.loads(raw) if raw else {}
        return snap if isinstance(snap, dict) else {}
    except json.JSONDecodeError:
        return {}


def get_model_scenes(db: Session) -> list[dict]:
    """模型 → 参与的工作任务（含启用状态，供设置页展示）。"""
    out = []
    for provider, scenes in MODEL_SCENES.items():
        enabled = _cfg(db, f"llm.{provider}.enabled") != "0"
        out.append({
            "name": provider,
            "label": PROVIDER_LABELS[provider],
            "enabled": enabled,
            "scenes": [
                {"scene": scene, "role": role, **SCENE_META[scene]}
                for scene, role in scenes
            ],
        })
    return out


def _remaining_of(items: list[dict]) -> float | None:
    """取配额项中最小数值剩余（无数值返回 None）。"""
    values = [it["remaining"] for it in items if it.get("remaining") is not None]
    return min(values) if values else None


def refresh_interval_minutes(db: Session) -> float:
    """自定义获取间隔（分钟）：quota.refresh.interval_minutes，未配置/非法时默认 60 分钟。

    兼容旧版本键 quota.refresh.interval_hours（小时）：发现旧键且新键未配置时，
    自动按 ×60 迁移到分钟并删除旧键。
    """
    interval = _num(_cfg(db, "quota.refresh.interval_minutes"))
    if interval is None or interval <= 0:
        # 旧版本（小时）配置迁移
        old = _num(_cfg(db, "quota.refresh.interval_hours"))
        if old is not None and old > 0:
            interval = old * 60
            _set_cfg(db, "quota.refresh.interval_minutes", str(interval))
            _drop_cfg(db, "quota.refresh.interval_hours")
            db.commit()
        else:
            interval = DEFAULT_INTERVAL_MINUTES
    return interval


def _drop_cfg(db: Session, key: str) -> None:
    row = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    if row is not None:
        db.delete(row)


def mark_quota_refreshed(db: Session) -> None:
    """记录最近一次配额获取时间（供间隔判断），立即提交。"""
    _set_cfg(db, LAST_REFRESH_KEY, datetime.now().isoformat(timespec="seconds"))
    db.commit()


def refresh_due(db: Session) -> bool:
    """是否到达自动获取时间：距上次获取 >= 配置间隔（分钟）（未获取过 → 立即）。"""
    raw = _cfg(db, LAST_REFRESH_KEY)
    if not raw:
        return True
    try:
        last = datetime.fromisoformat(raw)
    except ValueError:
        return True
    return datetime.now() - last >= timedelta(minutes=refresh_interval_minutes(db))


def refresh_quota_snapshots() -> dict:
    """定时自动获取配额（不依赖预警开关）：只对「已启用且已配置 API Key」的服务商
    拉取余额/用量并更新快照，保证设置页展示的配额是最新的；
    未启用 / 未配置 Key 的服务商不查询，并移除其旧快照（避免展示过期或失败信息）。"""
    db = SessionLocal()
    try:
        fetched = 0
        ok_count = 0
        skipped: list[str] = []
        for provider in PROVIDERS:
            if _cfg(db, f"llm.{provider}.enabled") == "0" or not _cfg(db, f"llm.{provider}.api_key"):
                _drop_quota_snapshot(db, provider)
                skipped.append(provider)
                continue
            payload = fetch_provider_quota(db, provider)
            save_quota_snapshot(db, provider, payload)
            fetched += 1
            if payload.get("ok"):
                ok_count += 1
        mark_quota_refreshed(db)  # 无论成败都记录本次执行时间（按配置间隔控制下次自动获取）
        return {"checked": fetched, "ok": ok_count, "skipped": skipped}
    except Exception as exc:  # noqa: BLE001 定时任务失败不影响主流程
        logger.error("配额自动获取失败：%s", exc)
        return {"checked": 0, "error": str(exc)}
    finally:
        db.close()


def check_quota_warnings() -> dict:
    """定时检查：按配置间隔（quota.refresh.interval_minutes，默认 60 分钟）自动获取配额快照，
    再按快照判断剩余配额是否低于阈值 → 低于阈值邮件通知收件人；恢复后清除告警标记
    （每个服务商只在跌破时通知一次）。调度器每 5 分钟轻量触发，内部判断是否到点。"""
    db = SessionLocal()
    try:
        # 未到配置的获取间隔 → 跳过（不刷新、不检查、不发邮件）
        if not refresh_due(db):
            return {"checked": 0, "reason": "not_due", "interval_minutes": refresh_interval_minutes(db)}
        # 定期自动获取配额（无论预警是否启用都刷新，保证设置页数据最新）
        refresh_result = refresh_quota_snapshots()
        # refresh 用独立会话提交；结束本会话事务（REPEATABLE READ 快照点），
        # 否则后续读取 quota.snapshot 仍看到刷新前的旧值
        db.commit()
        if _cfg(db, "quota.warning.enabled") != "1":
            return {"checked": 0, "reason": "disabled", "refresh": refresh_result}
        recipients = [
            r.strip() for r in _cfg(db, "quota.warning.recipients").replace("，", ",").split(",") if r.strip()
        ]
        if not recipients:
            return {"checked": 0, "reason": "no_recipients", "refresh": refresh_result}
        site = _cfg(db, "site.name", "物料通管理系统")

        rows: list[tuple[str, float, float, str]] = []  # provider, remaining, threshold, unit
        snap = get_quota_snapshot(db)
        for provider in PROVIDERS:
            threshold = _num(_cfg(db, f"quota.warning.threshold.{provider}"))
            if threshold is None or threshold <= 0:
                continue
            payload = snap.get(provider) or {}
            if not payload.get("ok"):
                continue
            remaining = _remaining_of(payload.get("items") or [])
            if remaining is None:
                continue
            notified_key = f"{NOTIFIED_PREFIX}{provider}"
            if remaining < threshold:
                if _cfg(db, notified_key) != "1":
                    rows.append((provider, remaining, threshold, (payload.get("items") or [{}])[0].get("unit", "")))
                    _set_cfg(db, notified_key, "1")
            elif _cfg(db, notified_key) == "1":
                _set_cfg(db, notified_key, "")  # 恢复：清除告警标记，允许再次跌破时重新通知

        db.commit()
        if not rows:
            return {"checked": 1, "emails": 0, "refresh": refresh_result}

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        lines = [f"以下 AI 服务剩余配额已低于告警阈值（检查时间 {now}）：", ""]
        for provider, remaining, threshold, unit in rows:
            lines.append(f"· {PROVIDER_LABELS[provider]}：当前剩余 {remaining:g} {unit}，阈值 {threshold:g} {unit}")
        lines += ["", "请及时充值或调整用量，避免影响拍照识别、送货单识别等业务功能。"]
        body = "\n".join(lines)
        for addr in recipients:
            send_mail(db, addr, f"【{site}】AI 服务配额预警", body)
        db.commit()
        logger.warning("配额预警已发送：%s → %s", [r[0] for r in rows], recipients)
        return {"checked": 1, "emails": len(recipients), "providers": [r[0] for r in rows], "refresh": refresh_result}
    except Exception as exc:  # noqa: BLE001 定时任务失败不影响主流程
        logger.error("配额检查失败：%s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return {"checked": 0, "error": str(exc)}
    finally:
        db.close()
