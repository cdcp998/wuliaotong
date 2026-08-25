"""系统接口：health、系统设置（OCR 引擎/大模型 API 等，管理员后台维护，《后端API设计.md》§9）。"""
from __future__ import annotations

import logging
import threading
import time
from io import BytesIO

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

logger = logging.getLogger("app.system")

from app import __version__
from app.config import settings
from app.core.cache import ping as redis_ping
from app.core.deps import require_permission
from app.core.response import BizError, E_LLM_FAILED, E_PARAM, ok
from app.db import get_db
from app.models.sys import LlmLog, SysConfig
from app.schemas.watermark import WatermarkPreviewReq
from app.services.llm import chat_text_with_fallback, invalidate_probe_cache, llm_availability_status
from app.services.ocr.client import ocr_engine_available
from app.services.watermark import (
    WATERMARK_DEFAULT_POSITION,
    WATERMARK_DEFAULT_TEMPLATE,
    WATERMARK_POSITIONS,
    render_template,
    render_watermark,
    sample_preview_image,
)

router = APIRouter(tags=["系统"])  # health 公开（运维探活）；settings 单独要求 sys:config

# 可配置项：str = 明文；secret = 密钥（GET 脱敏、PUT 传掩码/空不修改）
SETTINGS_KEYS: dict[str, str] = {
    "site.name": "str",
    "session.expire_hours": "str",
    "ocr.engine": "str",  # rapidocr / paddle
    "ocr.model_version": "str",  # PP-OCRv4 / PP-OCRv5 / PP-OCRv6（paddle 引擎模型版本）
    "llm.mm_llm.enabled": "str",  # 1 启用 / 0 关闭（关闭后拍照识别未匹配不再调用多模态大模型分析并提示）
    # 多模态大模型（MM-LLM，主用）任务开关：1 启用（默认）/ 0 关闭（该任务跳过主用，直接走备用模型）
    "llm.mm_llm.scene.match_vision": "str",  # 送货单参考匹配（主用）
    "llm.mm_llm.scene.vision_product": "str",  # 拍照识别商品（主用）
    "llm.mm_llm.scene.classify_items": "str",  # 材料自动分类（主用）
    "llm.mm_llm.scene.ocr_correct": "str",  # OCR 文本纠错（主用）
    "llm.mm_llm.scene.vision_text": "str",  # 视觉文字兜底（主用）
    "llm.mm_llm.scene.structured": "str",  # 送货单结构化（主用）
    # 视觉模型（备用）任务开关
    "llm.siliconflow.scene.vision_delivery": "str",  # 送货单识别（备用）
    "llm.siliconflow.scene.vision_product": "str",  # 拍照识别商品（备用）
    "llm.siliconflow.scene.vision_text": "str",  # 视觉文字兜底（备用）
    "llm.siliconflow.scene.match_vision": "str",  # 送货单参考匹配（备用）
    # 文本模型（备用）任务开关
    "llm.deepseek.scene.ocr_correct": "str",  # OCR 文本纠错（备用）
    "llm.deepseek.scene.classify_items": "str",  # 材料自动分类（备用）
    "llm.deepseek.scene.structured": "str",  # 送货单结构化（备用）
    "llm.deepseek.enabled": "str",  # 1 启用 / 0 关闭（关闭后送货单结构化仅用本地模板并提示）
    "llm.mm_llm.api_key": "secret",
    "llm.mm_llm.base_url": "str",
    "llm.mm_llm.model": "str",
    "llm.deepseek.api_key": "secret",
    "llm.deepseek.base_url": "str",
    "llm.deepseek.model": "str",
    "llm.siliconflow.enabled": "str",  # 1 启用 / 0 关闭（送货单视觉识别用）
    "llm.siliconflow.api_key": "secret",
    "llm.siliconflow.base_url": "str",
    "llm.siliconflow.model": "str",
    # 注册与找回（本轮需求）
    "auth.register_mode": "str",  # open 开放 / closed 关闭 / review 审核
    "auth.forgot_method": "str",  # email 邮箱找回 / phone 电话 / both
    "site.contact_phone": "str",  # 管理员联系电话（电话找回展示）
    "smtp.host": "str",
    "smtp.port": "str",
    "smtp.user": "str",
    "smtp.password": "secret",
    "smtp.from": "str",
    "watermark.template": "str",  # 完成工作照片水印模板（{location}/{time}/{gps} 占位符）
    "watermark.position": "str",  # 完成工作照片水印位置（bottom/top/bottom-left/bottom-right/top-left/top-right）
    "watermark.bg_opaque": "str",  # 水印背景：1 黑色不透明底（默认）/ 0 透明背景仅文字描边
    "log.level": "str",  # 运行时日志级别：DEBUG / INFO（默认）/ WARN / ERROR（保存后立即生效）
    # AI 服务配额与预警（设置页「OCR 与大模型 → 配额与预警」）
    "quota.warning.enabled": "str",  # 1 启用 / 0 关闭（定时检查剩余配额并邮件告警）
    "quota.warning.recipients": "str",  # 预警邮件收件人，逗号分隔
    "quota.refresh.interval_minutes": "str",  # 配额自动获取间隔（分钟），默认 60
    "quota.warning.threshold.siliconflow": "str",  # 视觉模型剩余余额低于该值（元）时告警
    "quota.warning.threshold.deepseek": "str",  # 文本模型剩余余额低于该值（元）时告警
    "quota.warning.threshold.mm_llm": "str",  # 多模态大模型剩余配额低于该值（与服务商返回数值同单位）时告警
}


def _mask(value: str) -> str:
    return f"****{value[-4:]}" if len(value) > 4 else "****"


# 旧版配置键迁移：多模态大模型槽位由 llm.doubao.* 更名为 llm.mm_llm.*（通用化，不绑定供应商）
_LEGACY_DOUBAO_SUFFIXES = (
    "enabled", "api_key", "base_url", "model",
    "scene.match_vision", "scene.vision_product", "scene.classify_items",
    "scene.ocr_correct", "scene.vision_text", "scene.structured",
)


def _migrate_legacy_doubao_config(db: Session) -> None:
    """一次性迁移旧版配置键 llm.doubao.* → llm.mm_llm.*（含配额阈值键）；新键已有值时跳过，不覆盖。"""
    try:
        changed = False
        for suffix in _LEGACY_DOUBAO_SUFFIXES:
            old = f"llm.doubao.{suffix}"
            new = f"llm.mm_llm.{suffix}"
            if db.scalar(select(SysConfig).where(SysConfig.config_key == new)) is not None:
                continue
            row = db.scalar(select(SysConfig).where(SysConfig.config_key == old))
            if row is None:
                continue
            db.add(SysConfig(config_key=new, config_value=row.config_value, remark=row.remark or "系统设置"))
            db.delete(row)
            changed = True
        old_th = "quota.warning.threshold.doubao"
        new_th = "quota.warning.threshold.mm_llm"
        if db.scalar(select(SysConfig).where(SysConfig.config_key == new_th)) is None:
            row = db.scalar(select(SysConfig).where(SysConfig.config_key == old_th))
            if row is not None:
                db.add(SysConfig(config_key=new_th, config_value=row.config_value, remark=row.remark or "系统设置"))
                db.delete(row)
                changed = True
        if changed:
            db.commit()
    except Exception:  # noqa: BLE001 迁移失败不影响设置读写
        db.rollback()


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """健康检查：数据库不可用时不报错（数据库未就绪/未安装时后端仍可启动并进入安装流程），
    db 字段如实标记 down；安装完成后 db down 即为故障（由部署探活/前端提示暴露）。"""
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.engine"))
        engine = cfg.config_value if cfg and cfg.config_value else settings.ocr_engine
        ver = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.model_version"))
        # LLM 服务商状态：只读配置（启用开关 + Key 是否已配置 + 模型），不做在线探测（探活不消耗配额）
        llm_cfg = {
            k: v
            for k, v in db.execute(
                select(SysConfig.config_key, SysConfig.config_value).where(SysConfig.config_key.like("llm.%"))
            ).all()
            if v
        }
    except Exception as exc:  # noqa: BLE001 数据库不可用不阻止健康检查
        logger.warning("健康检查读取数据库失败：%s", exc)
        db_ok = False
        engine = settings.ocr_engine
        ver = None
        llm_cfg = {}
    llm_state = {
        name: {
            "enabled": llm_cfg.get(f"llm.{name}.enabled") == "1",
            "configured": bool(llm_cfg.get(f"llm.{name}.api_key")),
            "model": llm_cfg.get(f"llm.{name}.model", ""),
        }
        for name in ("mm_llm", "deepseek", "siliconflow")
    }
    # 模型可用性（评审 P1-5）：免费探测（GET /models，不消耗 token）结果缓存 5 分钟，
    # 防止默认模型下线导致功能静默失效；db 不可用时无法读取配置 → 置空
    llm_availability = llm_availability_status(db) if db_ok else {}
    return ok(
        {
            "status": "ok",
            "version": __version__,
            "db": "ok" if db_ok else "down",
            "redis": "ok" if redis_ping() else "down",
            "llm": llm_state,
            "llm_availability": llm_availability,
            "ocr_engine": engine,
            "ocr_model_version": ver.config_value if ver and ver.config_value else ("PP-OCRv6" if engine == "paddle" else ""),
            "ocr_ready": ocr_engine_available(engine),
        }
    )


@router.get("/settings", dependencies=[Depends(require_permission("sys:config"))])
def get_settings(db: Session = Depends(get_db)) -> dict:
    """读取系统设置；密钥脱敏（只显示 **** 后四位）。"""
    _migrate_legacy_doubao_config(db)  # 旧版 llm.doubao.* 配置键一次性迁移到 llm.mm_llm.*
    out: dict[str, str] = {}
    for key, kind in SETTINGS_KEYS.items():
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
        value = cfg.config_value if cfg else ""
        out[key] = _mask(value) if kind == "secret" and value else value
    return ok(out)


# ============================ 导出格式设置（统一管理） ============================

@router.get("/export-formats")
def get_export_formats(db: Session = Depends(get_db)) -> dict:
    """读取导出格式配置（内置默认 + 全局已存 + 各模块覆盖 + 合并生效结果）。"""
    from app.services.export_service import get_all_formats

    return ok(get_all_formats(db))


@router.put("/export-formats/global", dependencies=[Depends(require_permission("sys:config"))])
def put_global_format(body: dict, db: Session = Depends(get_db)) -> dict:
    """保存全局默认导出格式（深合并存储；仅超管/管理者）。"""
    from app.services.export_service import save_global_format

    if not isinstance(body, dict):
        raise BizError(E_PARAM, "格式配置必须为 JSON 对象")
    save_global_format(db, body)
    return ok({"saved": True})


@router.put("/export-formats/module/{module_key}", dependencies=[Depends(require_permission("sys:config"))])
def put_module_format(module_key: str, body: dict | None, db: Session = Depends(get_db)) -> dict:
    """保存/清除模块级格式覆盖（body=null 表示清除覆盖、回退全局默认）。"""
    from app.services.export_service import save_module_format

    try:
        save_module_format(db, module_key, body)
    except ValueError as exc:
        raise BizError(E_PARAM, str(exc)) from exc
    return ok({"saved": True})


@router.put("/settings", dependencies=[Depends(require_permission("sys:config"))])
def update_settings(body: dict[str, str], db: Session = Depends(get_db)) -> dict:
    """部分更新系统设置；密钥字段传空或掩码（****）表示不修改。"""
    session_cfg_changed = False
    for key, value in body.items():
        if key not in SETTINGS_KEYS:
            raise BizError(E_PARAM, f"未知配置项: {key}")
        if key == "session.expire_hours":
            try:
                hours = float(str(value))
            except ValueError as e:
                raise BizError(E_PARAM, "会话有效期必须是数字（小时）") from e
            if not 1 <= hours <= 720:
                raise BizError(E_PARAM, "会话有效期必须在 1~720 小时之间")
            session_cfg_changed = True
        if key == "log.level":
            # 运行时日志级别：校验并立即生效（无需重启）
            from app.core.logging_config import set_log_level

            try:
                set_log_level(value)
            except ValueError as e:
                raise BizError(E_PARAM, str(e))
        if SETTINGS_KEYS[key] == "secret":
            if not value or value.startswith("****"):
                continue  # 不修改密钥
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
        if cfg is None:
            db.add(SysConfig(config_key=key, config_value=str(value), remark="系统设置"))
        else:
            cfg.config_value = str(value)
    db.commit()
    if session_cfg_changed:
        # 立即对后续登录/会话续期生效（进程内 60s 缓存失效）
        from app.core.deps import invalidate_session_cfg_cache

        invalidate_session_cfg_cache()
    if any(str(k).startswith("llm.") for k in body):
        # LLM 配置变更：清空模型可用性探测缓存，下次读取按新配置重新探测
        invalidate_probe_cache()
    logger.info("系统设置已更新：%s", ", ".join(body.keys()))
    return ok()


# ============================ 大模型模型列表 ============================


def _sys_config(db: Session, key: str) -> str:
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    return cfg.config_value if cfg else ""


def _fetch_models(base_url: str, api_key: str) -> list[dict]:
    """调用 OpenAI 兼容 /models 接口拉取模型列表（任意兼容服务商均支持）。"""
    try:
        resp = httpx.get(
            f"{base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:  # 网络/鉴权失败等
        logger.warning("获取模型列表失败：%s", e)
        raise BizError(E_LLM_FAILED, "获取模型列表失败，请检查网络与 API Key（详情见系统日志）") from e
    return [
        {"id": m.get("id", ""), "owned_by": m.get("owned_by", "")}
        for m in data.get("data", [])
        if m.get("id")
    ]


@router.post("/llm/siliconflow/models", dependencies=[Depends(require_permission("sys:config"))])
def list_siliconflow_models(db: Session = Depends(get_db)) -> dict:
    """用已保存的视觉模型 Key 拉取模型列表（设置页保存后展示，供选择模型）。"""
    if _sys_config(db, "llm.siliconflow.enabled") == "0":
        raise BizError(E_PARAM, "视觉模型未启用：请先在系统设置中打开「启用视觉模型」开关并保存")
    key = _sys_config(db, "llm.siliconflow.api_key")
    if not key:
        raise BizError(E_PARAM, "请先填写并保存视觉模型 API Key，再获取模型列表")
    base_url = _sys_config(db, "llm.siliconflow.base_url") or "https://api.siliconflow.cn/v1"
    return ok({"models": _fetch_models(base_url, key)})


@router.post("/llm/deepseek/models", dependencies=[Depends(require_permission("sys:config"))])
def list_deepseek_models(db: Session = Depends(get_db)) -> dict:
    """用已保存的文本模型 Key 拉取模型列表（设置页保存后展示，供选择模型）。"""
    if _sys_config(db, "llm.deepseek.enabled") == "0":
        raise BizError(E_PARAM, "文本模型未启用：请先在系统设置中打开「启用文本模型」开关并保存")
    key = _sys_config(db, "llm.deepseek.api_key")
    if not key:
        raise BizError(E_PARAM, "请先填写并保存文本模型 API Key，再获取模型列表")
    base_url = _sys_config(db, "llm.deepseek.base_url") or "https://api.deepseek.com/v1"
    return ok({"models": _fetch_models(base_url, key)})


@router.post("/llm/mm_llm/models", dependencies=[Depends(require_permission("sys:config"))])
def list_mm_llm_models(db: Session = Depends(get_db)) -> dict:
    """用已保存的多模态大模型 Key 拉取模型列表（设置页保存后展示，供选择模型）。"""
    if _sys_config(db, "llm.mm_llm.enabled") == "0":
        raise BizError(E_PARAM, "多模态大模型未启用：请先在系统设置中打开「启用多模态大模型」开关并保存")
    key = _sys_config(db, "llm.mm_llm.api_key")
    if not key:
        raise BizError(E_PARAM, "请先填写并保存多模态大模型 API Key，再获取模型列表")
    base_url = _sys_config(db, "llm.mm_llm.base_url")
    if not base_url:
        raise BizError(E_PARAM, "请先填写并保存多模态大模型 Base URL，再获取模型列表")
    return ok({"models": _fetch_models(base_url, key)})


# ============================ 配额与预警（OCR/大模型服务商） ============================


@router.get("/llm/quota", dependencies=[Depends(require_permission("sys:config"))])
def get_llm_quota(db: Session = Depends(get_db)) -> dict:
    """读取最近一次获取的各服务商配额快照（含失败信息，供设置页展示）。"""
    from app.services.quota import get_quota_snapshot

    return ok({"providers": get_quota_snapshot(db)})


@router.post("/llm/quota/{provider}", dependencies=[Depends(require_permission("sys:config"))])
def refresh_llm_quota(provider: str, db: Session = Depends(get_db)) -> dict:
    """立即从服务商获取配额/余额，结果存入快照；失败也返回 ok=False + 错误说明（优雅降级）。"""
    from app.services.quota import PROVIDERS, fetch_provider_quota, mark_quota_refreshed, save_quota_snapshot

    if provider not in PROVIDERS:
        raise BizError(E_PARAM, f"未知服务商: {provider}")
    payload = fetch_provider_quota(db, provider)
    save_quota_snapshot(db, provider, payload)
    mark_quota_refreshed(db)  # 手动获取视为一次刷新，重置自动获取计时
    return ok(payload)


@router.get("/llm/model-scenes", dependencies=[Depends(require_permission("sys:config"))])
def llm_model_scenes(db: Session = Depends(get_db)) -> dict:
    """模型参与的工作任务映射（含启用状态），供设置页「模型与工作任务」展示。"""
    from app.services.quota import get_model_scenes

    return ok({"models": get_model_scenes(db)})


# ============================ PP-OCR 自动安装 ============================
# 后台线程执行 pip install paddlepaddle paddleocr（Windows CPU 版），状态内存态（单进程部署足够）。

_install_state: dict = {"status": "idle", "log": ""}
_install_lock = threading.Lock()
_paddle_mode_cache: list = [0.0, None]  # [检测时间, "gpu"|"cpu"]，import paddle 较重，缓存 60s


def _detect_paddle_mode() -> str | None:
    """已安装的 paddle 是否启用 CUDA：gpu / cpu / None（未安装）。"""
    if not ocr_engine_available("paddle"):
        return None
    now = time.time()
    if _paddle_mode_cache[0] and now - _paddle_mode_cache[0] < 60:
        return _paddle_mode_cache[1]
    try:
        import paddle  # noqa: PLC0415

        mode = "gpu" if paddle.device.is_compiled_with_cuda() else "cpu"
    except Exception:  # noqa: BLE001  paddleocr 已装但 paddle 导入异常：按 cpu 兜底，不影响识别
        mode = "cpu"
    _paddle_mode_cache[0] = now
    _paddle_mode_cache[1] = mode
    return mode


@router.get("/ocr/install-status", dependencies=[Depends(require_permission("sys:config"))])
def ocr_install_status() -> dict:
    """PP-OCR 自动安装状态：idle / installing / done / failed，done 时附 mode（cpu/gpu）。

    以真实环境检测为准：后端重启后内存态重置为 idle，但 paddleocr 实际已安装时
    仍返回 done（设置页显示「已安装」，避免误提示未安装）。
    """
    with _install_lock:
        state = dict(_install_state)
    if state["status"] != "installing" and ocr_engine_available("paddle"):
        state["status"] = "done"
        state["log"] = "已安装（paddlepaddle + paddleocr），可直接选择 PP-OCR 引擎使用"
    if state["status"] == "done":
        state["mode"] = _detect_paddle_mode()
    return ok(state)


@router.post("/ocr/install-paddle", dependencies=[Depends(require_permission("sys:config"))])
def ocr_install_paddle() -> dict:
    """自动安装 PP-OCR（PaddleOCR）运行环境：pip install paddlepaddle paddleocr。

    后台执行（安装约 1-5 分钟），前端轮询 /ocr/install-status；完成后需重启后端生效。
    """
    with _install_lock:
        if _install_state["status"] == "installing":
            return ok(dict(_install_state))
        _install_state.update(status="installing", log="开始安装 paddlepaddle / paddleocr …")

    def _run() -> None:
        import subprocess  # noqa: PLC0415
        import sys  # noqa: PLC0415

        try:
            cmds = [
                # paddlepaddle 固定 3.2.2：3.3.x Windows CPU 版存在 oneDNN PIR 执行器 bug（识别报 NotImplementedError）
                [sys.executable, "-m", "pip", "install", "--no-warn-script-location", "paddlepaddle==3.2.2"],
                [sys.executable, "-m", "pip", "install", "--no-warn-script-location", "paddleocr"],
            ]
            log_parts: list[str] = []
            for cmd in cmds:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
                tail = (proc.stdout or "").strip().splitlines()[-3:]
                log_parts.extend(tail)
                if proc.returncode != 0:
                    err = (proc.stderr or "").strip().splitlines()[-5:]
                    with _install_lock:
                        _install_state.update(status="failed", log="\n".join(log_parts + err))
                    return
            with _install_lock:
                _install_state.update(
                    status="done",
                    mode=_detect_paddle_mode(),
                    log="安装完成。请重启后端生效，然后在「系统设置 → OCR 与大模型」选择 PP-OCR 引擎与模型版本。",
                )
        except Exception as e:  # noqa: BLE001
            with _install_lock:
                _install_state.update(status="failed", log=f"安装失败：{e}")

    threading.Thread(target=_run, daemon=True).start()
    return ok(dict(_install_state))


@router.post("/watermark/preview", dependencies=[Depends(require_permission("sys:config"))])
def watermark_preview(req: WatermarkPreviewReq, db: Session = Depends(get_db)):
    """水印预览（系统设置）：用示例底图即时渲染指定/当前模板与位置，未保存也可预览。"""
    template = req.template or (
        db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.template"))
        or WATERMARK_DEFAULT_TEMPLATE
    )
    position = req.position or (
        db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.position"))
        or WATERMARK_DEFAULT_POSITION
    )
    text = render_template(template, req.location, req.time, req.gps)
    # 背景透明开关：请求优先，其次读配置（默认不透明）
    bg_opaque = req.bg_opaque
    if bg_opaque is None:
        bg_cfg = db.scalar(select(SysConfig.config_value).where(SysConfig.config_key == "watermark.bg_opaque"))
        bg_opaque = bg_cfg != "0"
    img = render_watermark(
        sample_preview_image(),
        text,
        position if position in WATERMARK_POSITIONS else WATERMARK_DEFAULT_POSITION,
        bg_opaque=bg_opaque,
    )
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")


@router.get("/llm-logs", dependencies=[Depends(require_permission("sys:llm-log"))])
def list_llm_logs(
    scene: str = "",
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    """大模型调用日志查询（P9）：按场景/状态筛选，供后期调整与学习（输入输出截断保存）。"""
    stmt = select(LlmLog).order_by(LlmLog.id.desc())
    if scene:
        stmt = stmt.where(LlmLog.scene == scene)
    if status:
        stmt = stmt.where(LlmLog.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return ok({
        "list": [
            {
                "id": r.id, "scene": r.scene, "model": r.model,
                "prompt": r.prompt, "output": r.output,
                "status": r.status, "error": r.error,
                "duration_ms": r.duration_ms, "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            }
            for r in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    })


class LlmLogDeleteReq(BaseModel):
    """批量删除大模型调用日志请求：按 ID 列表删除（不含记录时静默跳过）。"""

    ids: list[int] = Field(min_length=1, description="要删除的日志 ID 列表")


@router.delete("/llm-logs", dependencies=[Depends(require_permission("sys:llm-log"))])
def delete_llm_logs(req: LlmLogDeleteReq, db: Session = Depends(get_db)) -> dict:
    """批量删除大模型调用日志（支持勾选多条后删除）。"""
    result = db.execute(delete(LlmLog).where(LlmLog.id.in_(req.ids)))
    db.commit()
    logger.info("批量删除大模型调用日志 %d 条", result.rowcount or 0)
    return ok({"deleted": result.rowcount or 0})


@router.post("/llm-logs/{log_id}/replay", dependencies=[Depends(require_permission("sys:llm-log"))])
def replay_llm_log(log_id: int, db: Session = Depends(get_db)) -> dict:
    """重放失败的大模型调用（设计页 31 失败可重放）：用该日志记录的 prompt 重新调用当前配置的模型。
    重放会写入一条新的调用日志（记录本次重放结果），便于对照学习。"""
    log = db.get(LlmLog, log_id)
    if log is None:
        raise BizError(E_PARAM, "日志不存在")
    try:
        out = chat_text_with_fallback(db, "", log.prompt or "", log.scene or "")
        return ok({"status": "ok", "output": out})
    except Exception as e:  # noqa: BLE001
        raise BizError(E_LLM_FAILED, f"重放失败：{e}") from e
