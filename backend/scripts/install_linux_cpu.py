#!/usr/bin/env python3
"""物料通管理系统 · Linux 环境安装脚本（CPU 版）。

用法：python3 install_linux_cpu.py [项目根目录，默认脚本所在目录的上一级]

流程：环境检测（OS/Python/pip/内存/磁盘）→ 要求说明与确认 → 创建 venv →
安装依赖（backend/requirements.txt + PP-OCR CPU 版）→ 验证安装。
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import venv
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else SCRIPT_DIR.parent
REQ = PROJECT_DIR / "backend" / "requirements.txt"


def run(cmd: list[str], timeout: int = 1800, retries: int = 1, **kw) -> subprocess.CompletedProcess:
    """执行命令并监控：打印命令、超时控制、失败自动重试（网络抖动兜底）。

    - timeout：命令超时上限（pip 安装默认 30 分钟，超时抛错并提示）
    - retries：失败重试次数（默认 1 次），重试仍失败返回最后一次结果
    """
    last: subprocess.CompletedProcess | None = None
    for attempt in range(retries + 1):
        print(f"  → {' '.join(cmd)}" + (f"（第 {attempt + 1} 次尝试）" if attempt else ""))
        try:
            last = subprocess.run(cmd, timeout=timeout, **kw)
            if last.returncode == 0:
                return last
            print(f"  ! 退出码 {last.returncode}，{'准备重试…' if attempt < retries else '重试已达上限'}")
        except subprocess.TimeoutExpired:
            print(f"  ! 命令超过 {timeout}s 仍未完成" + ("，尝试重试…" if attempt < retries else "，放弃"))
            last = None
    if last is None:
        fail("命令执行超时（可增大 timeout 参数后重试）")
    return last


def detect() -> dict:
    print("==> 检测当前环境 …")
    info: dict = {}
    info["os"] = f"{platform.system()} {platform.machine()}"
    print(f"  - 操作系统：{info['os']}")

    py = sys.executable
    info["python"] = f"{platform.python_version()}"
    print(f"  - Python：{py} ({info['python']})")
    if sys.version_info < (3, 9):
        fail(f"Python 版本过低（需 ≥ 3.9，当前 {info['python']}）")

    pip_ver = subprocess.run(
        [py, "-m", "pip", "--version"], capture_output=True, text=True
    ).stdout.split()[1]
    info["pip"] = pip_ver
    print(f"  - pip：{pip_ver}")

    if platform.system() == "Linux":
        mem = int(open("/proc/meminfo").read().splitlines()[0].split()[1]) // 1024 // 1024
        disk = shutil.disk_usage(str(PROJECT_DIR)).free // (1024**3)
        print(f"  - 内存：{mem} GB ｜ 磁盘剩余：{disk} GB")
        info["mem_gb"], info["disk_gb"] = mem, disk
    return info


def confirm(info: dict, yes: bool = False) -> None:
    print()
    print("==================== 环境要求（CPU 版） ====================")
    print("  操作系统 ：Linux x86_64（Ubuntu/Debian/CentOS 等）")
    print("  Python   ：≥ 3.9（推荐 3.10-3.13）")
    print("  pip      ：≥ 21.0")
    print("  内存     ：≥ 4 GB（推荐 8 GB+，OCR 识别与 MySQL 同机运行）")
    print("  磁盘     ：剩余 ≥ 5 GB（依赖 + 模型文件）")
    print("  说明     ：识别引擎使用 CPU 推理（RapidOCR / PP-OCR CPU 版）")
    print("============================================================")
    if not yes and input("请确认当前环境满足以上要求？继续安装请输入 y，否则回车退出：[y/N] ").strip().lower() != "y":
        print("已取消安装。")
        sys.exit(0)


def install() -> Path:
    venv_dir = PROJECT_DIR / "backend" / ".venv"
    print(f"==> 创建虚拟环境 {venv_dir} …")
    if not (venv_dir / "bin" / "python").exists():
        venv.EnvBuilder(with_pip=True).create(venv_dir)
    vpy = venv_dir / "bin" / "python"
    print("==> 升级 pip 并安装依赖（backend/requirements.txt）…")
    run([str(vpy), "-m", "pip", "install", "--upgrade", "pip"])
    if run([str(vpy), "-m", "pip", "install", "-r", str(REQ)]).returncode != 0:
        fail("依赖安装失败")
    print("==> 安装可选 OCR 引擎 PP-OCR（CPU 版，模型首次识别时自动下载）…")
    if run([str(vpy), "-m", "pip", "install", "paddlepaddle==3.2.2", "paddleocr"]).returncode != 0:
        print("  ! PP-OCR 安装失败可跳过（RapidOCR 仍可用）")
    return vpy


def verify(vpy: Path) -> None:
    print()
    print("==> 验证安装 …")
    code = f"""
import sys; sys.path.insert(0, r"{PROJECT_DIR / 'backend'}")
import fastapi, sqlalchemy, pymysql, openpyxl
print("  ✓ FastAPI", fastapi.__version__, "| SQLAlchemy", sqlalchemy.__version__)
from app.services.ocr.client import ocr_engine_available
print("  ✓ RapidOCR 可用：", ocr_engine_available("rapidocr"))
try:
    import paddleocr
    print("  ✓ PP-OCR 已安装（CPU）")
except ImportError:
    # 兜底：PP-OCR 缺失时 RapidOCR 仍可用，识别流程不受影响
    print("  ! PP-OCR 未安装 → 已自动兜底使用 RapidOCR（可后续运行 scripts/setup_ppocr.py 安装）")
    print("  ! 兜底引擎检测：RapidOCR 可用 =", "是" if ocr_engine_available("rapidocr") else "否")
print("  验证通过")
"""
    r = run([str(vpy), "-c", code])
    if r.returncode != 0:
        fail("验证失败")
    print()
    print("==================== 安装完成 ====================")
    print("  启动后端：cd backend && source .venv/bin/activate && \\")
    print("    uvicorn app.main:app --host 0.0.0.0 --port 8443 \\")
    print("      --ssl-keyfile certs/dev/key.pem --ssl-certfile certs/dev/cert.pem")
    print("  初始化数据库：mysql -uroot -p wuliaotong < backend/sql/init.sql")
    print("==================================================")


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="物料通 · Linux CPU 环境安装")
    parser.add_argument("--yes", action="store_true", help="跳过确认提示（前端调用时使用）")
    parser.add_argument("project_dir", nargs="?", default=str(PROJECT_DIR), help="项目根目录")
    args = parser.parse_args()
    info = detect()
    confirm(info, yes=args.yes)
    vpy = install()
    verify(vpy)


if __name__ == "__main__":
    main()
