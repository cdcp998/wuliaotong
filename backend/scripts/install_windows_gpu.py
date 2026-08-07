#!/usr/bin/env python3
"""物料通管理系统 · Windows 环境安装脚本（GPU 版）。

用法（在项目根目录或任意位置）：
    py backend\\scripts\\install_windows_gpu.py
    # 或 python backend\\scripts\\install_windows_gpu.py

流程：GPU 硬件/环境检测（nvidia-smi）→ 要求说明与确认 → 创建 venv →
安装依赖（backend/requirements.txt + CUDA 匹配的 paddlepaddle-gpu）→
GPU 验证。全程命令监控（超时/重试），GPU 安装失败自动提供 CPU 版降级兜底。
"""
from __future__ import annotations

import platform
import shutil
import subprocess
import sys
import venv
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else SCRIPT_DIR.parent
REQ = PROJECT_DIR / "backend" / "requirements.txt"


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def run(cmd: list[str], timeout: int = 1800, retries: int = 1, **kw) -> subprocess.CompletedProcess:
    """执行命令并监控：打印命令、超时控制、失败自动重试（网络抖动兜底）。"""
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
    if platform.system() != "Windows":
        print("  ! 非 Windows 系统，请使用 install_linux_gpu.py")
    info: dict = {"os": f"{platform.system()} {platform.machine()}"}
    print(f"  - 操作系统：{info['os']}")
    py = sys.executable
    info["python"] = platform.python_version()
    print(f"  - Python：{py} ({info['python']})")
    if sys.version_info < (3, 9):
        fail(f"Python 版本过低（需 ≥ 3.9，当前 {info['python']}）")
    pip_ver = subprocess.run([py, "-m", "pip", "--version"], capture_output=True, text=True).stdout.split()[1]
    info["pip"] = pip_ver
    print(f"  - pip：{pip_ver}")
    return info


def detect_gpu() -> dict:
    print("==> 检测 GPU 环境 …")
    nvidia = shutil.which("nvidia-smi")
    if nvidia is None:
        fail("未检测到 nvidia-smi：无 NVIDIA 驱动或驱动未安装。请先安装 NVIDIA 驱动（https://www.nvidia.com/Download/index.aspx）后重试。")
    gpu: dict = {}
    for key, query in (
        ("name", "name"), ("memory_mb", "memory.total"), ("cc", "compute_cap"),
        ("driver", "driver_version"),
    ):
        out = subprocess.run(
            [nvidia, "--query-gpu", query, "--format", "csv,noheader,nounits"],
            capture_output=True, text=True,
        ).stdout.strip().splitlines()
        gpu[key] = out[0].strip() if out else ""
    try:
        gpu["memory_mb"] = int(float(gpu["memory_mb"]))
    except ValueError:
        gpu["memory_mb"] = 0
    print(f"  - GPU：{gpu['name']}")
    print(f"  - 显存：{gpu['memory_mb']} MB ｜ 计算能力：{gpu['cc']} ｜ 驱动：{gpu['driver']}")
    if gpu["memory_mb"] < 4096:
        fail(f"显存不足（需 ≥ 4 GB，当前 {gpu['memory_mb']} MB），不满足 GPU 推理要求")
    try:
        cc_major = int(str(gpu["cc"]).split(".")[0] or 0)
    except ValueError:
        cc_major = 0
    if cc_major < 6:
        fail(f"GPU 计算能力过低（需 ≥ 6.0，当前 {gpu['cc']}），不满足要求")
    return gpu


def confirm(gpu: dict, yes: bool = False) -> None:
    print()
    print("==================== GPU 版硬件要求 ====================")
    print("  NVIDIA GPU      ：必需（NVIDIA 独立显卡/专业卡）")
    print("  计算能力        ：≥ 6.0（GTX 10 系列及以上；推荐 7.5+，如 RTX 20/30/40 系列）")
    print("  显存            ：≥ 4 GB（推荐 8 GB+；识别大图/高并发更流畅）")
    print("  显卡驱动        ：≥ 470.82（CUDA 11.8）/ ≥ 525.60（CUDA 12.x）")
    print("  说明            ：paddlepaddle-gpu 官方 wheel 自带 CUDA/cuDNN 运行时，")
    print("                    仅需系统驱动满足对应 CUDA 版本要求即可")
    print("==================== 环境要求 ====================")
    print("  Python          ：≥ 3.9（推荐 3.10-3.13）")
    print("  pip             ：≥ 21.0")
    print("  内存 / 磁盘     ：≥ 8 GB / 剩余 ≥ 10 GB（GPU 库约 2-3 GB + 模型）")
    print("========================================================")
    print(f"  当前 GPU：{gpu['name']}（{gpu['memory_mb']} MB，计算能力 {gpu['cc']}）")
    print(f"  驱动版本：{gpu['driver']}")
    if not yes and input("确认满足要求并继续安装？输入 y 继续，否则回车退出：[y/N] ").strip().lower() != "y":
        print("已取消安装。")
        sys.exit(0)


def choose_cuda(cuda: str = "") -> str:
    if cuda in ("cu126", "cu123", "cu118"):
        return cuda
    print()
    print("==> 选择 CUDA 版本（以驱动支持为准）…")
    print("  1) CUDA 12.6（推荐，需驱动 ≥ 560.28）")
    print("  2) CUDA 12.3（需驱动 ≥ 545.23）")
    print("  3) CUDA 11.8（需驱动 ≥ 520.61）")
    choice = input("请输入序号 [1-3，默认 1]：").strip() or "1"
    return {"2": "cu123", "3": "cu118"}.get(choice, "cu126")


def install(cuda_tag: str, gpu_ok: bool) -> Path:
    venv_dir = PROJECT_DIR / "backend" / ".venv"
    print(f"==> 创建虚拟环境 {venv_dir} …")
    if not (venv_dir / "Scripts" / "python.exe").exists():
        venv.EnvBuilder(with_pip=True).create(venv_dir)
    vpy = venv_dir / "Scripts" / "python.exe"
    print("==> 升级 pip 并安装项目依赖（backend/requirements.txt）…")
    run([str(vpy), "-m", "pip", "install", "--upgrade", "pip"])
    if run([str(vpy), "-m", "pip", "install", "-r", str(REQ)]).returncode != 0:
        fail("依赖安装失败")
    if gpu_ok:
        print(f"==> 安装 GPU 版 PP-OCR（paddlepaddle-gpu 3.2.2 {cuda_tag} + paddleocr）…")
        r = run(
            [str(vpy), "-m", "pip", "install", "paddlepaddle-gpu==3.2.2",
             "-i", f"https://www.paddlepaddle.org.cn/packages/stable/{cuda_tag}/"],
            retries=0,
        )
        if r.returncode != 0:
            # 兜底：GPU 安装失败 → 询问降级 CPU 版（识别功能仍可用）
            print("  ! GPU 版安装失败（网络/源问题或驱动不匹配）")
            if input("是否降级安装 CPU 版 paddlepaddle 作为兜底？输入 y 继续，否则回车跳过：[y/N] ").strip().lower() == "y":
                print("  → 降级安装 CPU 版（paddlepaddle==3.2.2）…")
                run([str(vpy), "-m", "pip", "install", "paddlepaddle==3.2.2"])
            else:
                print("  → 跳过 PP-OCR（RapidOCR 仍可用）")
        run([str(vpy), "-m", "pip", "install", "paddleocr"])
    else:
        print("==> 未启用 GPU，安装 CPU 版 PP-OCR（paddlepaddle==3.2.2 + paddleocr）…")
        run([str(vpy), "-m", "pip", "install", "paddlepaddle==3.2.2", "paddleocr"])
    return vpy


def verify(vpy: Path) -> None:
    print()
    print("==> 验证安装（监控兜底：GPU 不可用时自动降级 CPU 推理）…")
    code = f"""
import sys; sys.path.insert(0, r"{PROJECT_DIR / 'backend'}")
import fastapi, sqlalchemy, pymysql, openpyxl
print("  ✓ FastAPI", fastapi.__version__, "| SQLAlchemy", sqlalchemy.__version__)
try:
    import paddle
    print("  ✓ paddle", paddle.__version__)
    if paddle.device.is_compiled_with_cuda():
        print("  ✓ CUDA 可用，设备：", paddle.device.cuda.get_device_name(0))
    else:
        print("  ! paddle 未启用 CUDA（驱动不匹配或已降级 CPU 版）→ 自动兜底 CPU 推理")
except ImportError:
    print("  ! PP-OCR 未安装 → 兜底引擎 RapidOCR（识别流程不受影响）")
from app.services.ocr.client import ocr_engine_available
print("  ✓ RapidOCR 可用：", ocr_engine_available("rapidocr"))
print("  验证通过")
"""
    if run([str(vpy), "-c", code]).returncode != 0:
        fail("验证失败")
    print()
    print("==================== 安装完成 ====================")
    print("  启动后端：cd backend && .venv\\Scripts\\activate && \\")
    print("    uvicorn app.main:app --host 0.0.0.0 --port 8443 \\")
    print("      --ssl-keyfile certs/dev/key.pem --ssl-certfile certs/dev/cert.pem")
    print("  选择引擎：系统设置 → OCR 与大模型 → PP-OCR（模型版本 PP-OCRv6）")
    print("  备注：paddlepaddle-gpu 官方 wheel 自带 CUDA/cuDNN 运行时，无需单独安装")
    print("==================================================")


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="物料通 · GPU 环境安装")
    parser.add_argument("--yes", action="store_true", help="跳过确认提示（前端调用时使用）")
    parser.add_argument("--cuda", default="", choices=["cu126", "cu123", "cu118"], help="CUDA 版本（前端调用时指定）")
    parser.add_argument("project_dir", nargs="?", default=str(PROJECT_DIR), help="项目根目录")
    args = parser.parse_args()
    detect()
    gpu = detect_gpu()
    confirm(gpu, yes=args.yes)
    cuda_tag = choose_cuda(args.cuda)
    vpy = install(cuda_tag, gpu_ok=True)
    verify(vpy)


if __name__ == "__main__":
    main()
