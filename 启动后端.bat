@echo off
chcp 65001 >nul
title 物料通 - 后端 (8443)
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo [错误] 未找到 backend\.venv，请先初始化环境：
  echo   cd backend ^&^& python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)
if not exist "certs\dev\cert.pem" (
  echo [错误] 未找到后端证书 certs\dev\cert.pem，请按 README「生成开发者证书」一节生成
  pause
  exit /b 1
)
echo 启动后端（HTTPS https://localhost:8443 ，内网 https://本机IP:8443）...
echo 关闭本窗口即停止后端。
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs\dev\key.pem --ssl-certfile certs\dev\cert.pem
pause
