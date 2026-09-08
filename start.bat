@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting AI Media Studio...
node server/index.js
pause
