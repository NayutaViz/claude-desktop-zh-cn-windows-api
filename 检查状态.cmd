@echo off
setlocal EnableExtensions
chcp 65001 >nul
echo 正在启动 Claude 汉化补丁，请稍候...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\launch.ps1" -Action status
set "patch_result=%errorlevel%"
echo.
pause
exit /b %patch_result%
