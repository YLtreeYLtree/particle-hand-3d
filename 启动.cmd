@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8765

where node >nul 2>nul
if %errorlevel%==0 (
  node serve.mjs %PORT%
  goto end
)

if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" serve.mjs %PORT%
  goto end
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py %PORT%
  goto end
)

echo.
echo   未找到 Node.js 或 Python，无法启动本地服务器。
echo   安装 Node.js 后双击本文件即可： https://nodejs.org
echo.
pause

:end
