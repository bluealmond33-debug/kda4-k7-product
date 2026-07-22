@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-distributed-server.ps1" %*
exit /b %errorlevel%
