@echo off
chcp 65001 >nul

:: Check and kill any process listening on port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo Killing process with PID %%a...
    taskkill /F /PID %%a >nul 2>&1
)

:: Start the server
cd /d "%~dp0"
node server/index.js

pause
