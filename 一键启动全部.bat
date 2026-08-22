@echo off
title 物料通 - 一键启动
cd /d "%~dp0"
echo 正在启动 后端(8443) / 电脑端(5174) / 手机端(5175)，各占一个窗口...
start "物料通-后端" cmd /k call "%~dp0启动后端.bat"
start "物料通-电脑端" cmd /k call "%~dp0启动桌面端.bat"
start "物料通-手机端" cmd /k call "%~dp0启动手机端.bat"
echo.
echo 访问地址：
echo   电脑端 https://localhost:5174
echo   手机端 https://localhost:5175
echo   接口   https://localhost:8443/api/v1/health
echo 三个服务窗口常驻不自动关闭；关闭服务窗口即停止对应服务。
echo 本窗口可关闭，不影响三个服务窗口。
pause
