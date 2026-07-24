@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-phone-ars.ps1" %*
exit /b %errorlevel%
