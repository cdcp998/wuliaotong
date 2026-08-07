@echo off
chcp 65001 >nul
title 物料通 - 电脑端 (5174)
cd /d "%~dp0frontend"
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装 Node.js 并加入 PATH
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [信息] 首次运行：安装依赖，请稍候...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败
    pause
    exit /b 1
  )
)
echo 启动电脑端（https://localhost:5174 ，内网 https://本机IP:5174）...
echo 关闭本窗口即停止电脑端。
call npm run dev:desktop
pause
