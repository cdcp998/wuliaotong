@echo off
chcp 65001 >nul
title 物料通 - 一键启动
cd /d "%~dp0"
echo 正在启动 后端(8443) / 电脑端(5174) / 手机端(5175)，各占一个窗口...
start "物料通-后端" cmd /c call "%~dp0启动后端.bat"
start "物料通-电脑端" cmd /c call "%~dp0启动桌面端.bat"
start "物料通-手机端" cmd /c call "%~dp0启动手机端.bat"
echo.
echo 访问地址：
echo   电脑端 https://localhost:5174
echo   手机端 https://localhost:5175
echo   接口   https://localhost:8443/api/v1/health
echo 本窗口可关闭；三个服务窗口需分别关闭以停止。
pause
