"""系统接口：health、系统设置（OCR 引擎/大模型 API 等，管理员后台维护，《后端API设计.md》§9）。"""
from __future__ import annotations

import threading
import time
from io import BytesIO

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.core.deps import require_permission
from app.core.response import BizError, E_LLM_FAILED, E_PARAM, ok
from app.db import get_db
from app.models.sys import SysConfig
from app.schemas.watermark import WatermarkPreviewReq
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
    "llm.doubao.enabled": "str",  # 1 启用 / 0 关闭（关闭后拍照识别未匹配不再调用豆包分析并提示）
    "llm.deepseek.enabled": "str",  # 1 启用 / 0 关闭（关闭后送货单结构化仅用本地模板并提示）
    "bill.rule": "str",
    "llm.doubao.api_key": "secret",
    "llm.doubao.base_url": "str",
    "llm.doubao.model": "str",
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
}


def _mask(value: str) -> str:
    return f"****{value[-4:]}" if len(value) > 4 else "****"


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.engine"))
    engine = cfg.config_value if cfg and cfg.config_value else settings.ocr_engine
    ver = db.scalar(select(SysConfig).where(SysConfig.config_key == "ocr.model_version"))
    return ok(
        {
            "status": "ok",
            "db": "ok",
            "ocr_engine": engine,
            "ocr_model_version": ver.config_value if ver and ver.config_value else ("PP-OCRv6" if engine == "paddle" else ""),
            "ocr_ready": ocr_engine_available(engine),
        }
    )


@router.get("/settings", dependencies=[Depends(require_permission("sys:config"))])
def get_settings(db: Session = Depends(get_db)) -> dict:
    """读取系统设置；密钥脱敏（只显示 **** 后四位）。"""
    out: dict[str, str] = {}
    for key, kind in SETTINGS_KEYS.items():
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
        value = cfg.config_value if cfg else ""
        out[key] = _mask(value) if kind == "secret" and value else value
    return ok(out)


@router.put("/settings", dependencies=[Depends(require_permission("sys:config"))])
def update_settings(body: dict[str, str], db: Session = Depends(get_db)) -> dict:
    """部分更新系统设置；密钥字段传空或掩码（****）表示不修改。"""
    for key, value in body.items():
        if key not in SETTINGS_KEYS:
            raise BizError(E_PARAM, f"未知配置项: {key}")
        if SETTINGS_KEYS[key] == "secret":
            if not value or value.startswith("****"):
                continue  # 不修改密钥
        cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
        if cfg is None:
            db.add(SysConfig(config_key=key, config_value=str(value), remark="系统设置"))
        else:
            cfg.config_value = str(value)
    db.commit()
    return ok()


# ============================ 大模型模型列表 ============================


def _sys_config(db: Session, key: str) -> str:
    cfg = db.scalar(select(SysConfig).where(SysConfig.config_key == key))
    return cfg.config_value if cfg else ""


def _fetch_models(base_url: str, api_key: str) -> list[dict]:
    """调用 OpenAI 兼容 /models 接口拉取模型列表（SiliconFlow/DeepSeek 均支持）。"""
    try:
        resp = httpx.get(
            f"{base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:  # 网络/鉴权失败等
        raise BizError(E_LLM_FAILED, f"获取模型列表失败：{e}")
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


@router.post("/llm/doubao/models", dependencies=[Depends(require_permission("sys:config"))])
def list_doubao_models(db: Session = Depends(get_db)) -> dict:
    """用已保存的豆包 Key 拉取模型列表（设置页保存后展示，供选择模型）。"""
    if _sys_config(db, "llm.doubao.enabled") == "0":
        raise BizError(E_PARAM, "豆包大模型未启用：请先在系统设置中打开「启用豆包大模型」开关并保存")
    key = _sys_config(db, "llm.doubao.api_key")
    if not key:
        raise BizError(E_PARAM, "请先填写并保存豆包 API Key，再获取模型列表")
    base_url = _sys_config(db, "llm.doubao.base_url") or "https://ark.cn-beijing.volces.com/api/v3"
    return ok({"models": _fetch_models(base_url, key)})


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
