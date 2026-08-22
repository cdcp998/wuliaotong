"""PP-OCR（PaddleOCR）运行环境自动安装脚本（Windows 可直接运行）。

用法：
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\setup_ppocr.py

功能：
1. 交互选择识别引擎/模型版本（RapidOCR 保留现状 / PP-OCRv6）
2. 自动检测并安装运行环境：pip install paddlepaddle paddleocr（CPU 版）
3. 自动下载 PP-OCR 模型并验证识别（模型由 PaddleOCR 首次初始化时下载到 backend/model/official_models）
4. 将选择写入系统配置（sys_config：ocr.engine / ocr.model_version），后端立即生效（识别时按配置加载）
5. 输出使用说明

也可在「系统设置 → OCR 与大模型」中点击「自动安装」完成同样流程。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

MODELS = {
    "2": ("PP-OCRv6", "PP-OCRv6"),
}


def _banner() -> None:
    print("=" * 62)
    print("  物料通 · OCR 引擎安装向导（Windows）")
    print("=" * 62)
    print("  1) RapidOCR-json  （现状，无需安装）")
    for k, (_ver, desc) in MODELS.items():
        print(f"  {k}) PP-OCR          （{desc}）")
    print("-" * 62)


def _choose() -> str:
    while True:
        choice = input("请选择 OCR 引擎 [1/2]：").strip() or "2"
        if choice == "1":
            print("保持 RapidOCR-json 引擎，退出。")
            sys.exit(0)
        if choice in MODELS:
            return MODELS[choice][0]
        print("无效选择，请重新输入（1=保持现状，2=PP-OCRv6）。")


def _install() -> None:
    """自动检测并安装 paddlepaddle + paddleocr（Windows CPU 版）。"""
    print("\n[1/3] 检测并安装运行环境 …")
    for pkg in ("paddlepaddle==3.2.2", "paddleocr"):  # paddlepaddle 固定 3.2.2（3.3.x Windows CPU 有 oneDNN bug）
        print(f"  → pip install {pkg}")
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--no-warn-script-location", pkg],
            capture_output=True, text=True, timeout=1800,
        )
        tail = (proc.stdout or "").strip().splitlines()[-2:]
        for line in tail:
            print(f"     {line.strip()}")
        if proc.returncode != 0:
            err = (proc.stderr or "").strip().splitlines()[-5:]
            print("\n安装失败：\n" + "\n".join(err))
            print("请检查网络后重试，或手动执行：pip install paddlepaddle paddleocr")
            sys.exit(1)
    print("  → 运行环境安装完成")


def _verify(model_version: str) -> None:
    """初始化 PaddleOCR（自动下载模型）并识别一张测试图验证。"""
    print(f"\n[2/3] 下载 {model_version} 模型并验证识别（首次约 1-3 分钟，视网络）…")
    import io

    from PIL import Image

    sys.path.insert(0, str(BACKEND_DIR))
    from app.services.ocr.paddleocr_api import PaddleOCREngine, OCRInitError

    try:
        engine = PaddleOCREngine(model_version=model_version)
        # 生成一张中文测试图（无需外部图片）
        from PIL import ImageDraw, ImageFont

        img = Image.new("RGB", (420, 80), "white")
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 28)
        except Exception:
            font = ImageFont.load_default()
        draw.text((12, 20), "物料通 PP-OCR 测试 轴承6204", fill="black", font=font)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        lines = engine.recognize(buf.getvalue())
        texts = [l.text for l in lines]
        print(f"  → 识别结果：{texts}")
        if not texts:
            print("  ⚠ 识别结果为空，请检查模型下载/图片质量")
    except OCRInitError as e:
        print(f"  ✗ 验证失败：{e}")
        sys.exit(1)


def _write_config(model_version: str) -> None:
    """将引擎选择写入系统配置（sys_config），后端识别时按配置加载。"""
    print(f"\n[3/3] 写入系统配置：ocr.engine=paddle, ocr.model_version={model_version}")
    try:
        import pymysql  # noqa: PLC0415
    except ImportError:
        print("  ✗ 缺少 pymysql（后端依赖），跳过写库；可稍后在「系统设置」中选择引擎并保存。")
        return
    env_path = BACKEND_DIR / ".env"
    db_url = ""
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("DB_URL="):
                db_url = line.split("=", 1)[1].strip()
    if not db_url:
        print("  ✗ 未找到 backend/.env 的 DB_URL，跳过写库；可在「系统设置」中手动选择。")
        return
    # mysql+pymysql://user:pass@host:port/db?charset=...
    try:
        rest = db_url.split("://", 1)[1].split("?", 1)[0]
        userinfo, hostpart = rest.split("@", 1)
        user, password = userinfo.split(":", 1)
        hostport, database = hostpart.split("/", 1)
        host, port = (hostport.split(":", 1) + ["3306"])[:2]
        conn = pymysql.connect(host=host, port=int(port), user=user, password=password, database=database, charset="utf8mb4")
        with conn.cursor() as cur:
            for key, value in (("ocr.engine", "paddle"), ("ocr.model_version", model_version)):
                cur.execute(
                    "INSERT INTO sys_config (config_key, config_value, remark) VALUES (%s, %s, 'OCR 引擎安装向导') "
                    "ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
                    (key, value),
                )
        conn.commit()
        conn.close()
        print("  → 配置已写入，识别将使用 PP-OCR 引擎")
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ 写库失败：{e}\n    可稍后在「系统设置 → OCR 与大模型」选择引擎与模型版本并保存。")


def _usage(model_version: str) -> None:
    print("\n" + "=" * 62)
    print("  安装完成！使用说明")
    print("=" * 62)
    print(f"  1. 当前配置：识别引擎 PP-OCR（{model_version}），模型已下载至 backend/model/official_models")
    print("  2. 如后端正在运行，请重启后端（uvicorn）使配置生效")
    print("  3. 验证：浏览器访问 /api/v1/health，ocr_engine=paddle、ocr_ready=true 即就绪")
    print("  4. 切换回 RapidOCR：系统设置 → OCR 与大模型 → 识别引擎选择 RapidOCR 并保存")
    print("  5. 大模型开关：系统设置 → OCR 与大模型 → 多模态/文本模型启用开关；关闭后对应功能自动降级并提示")
    print("  6. 卸载：pip uninstall paddleocr paddlepaddle")
    print("=" * 62)


def main() -> None:
    _banner()
    model_version = _choose()
    _install()
    _verify(model_version)
    _write_config(model_version)
    _usage(model_version)


if __name__ == "__main__":
    main()
