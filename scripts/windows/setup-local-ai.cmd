@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local-ai.ps1" %*
exit /b %errorlevel%
