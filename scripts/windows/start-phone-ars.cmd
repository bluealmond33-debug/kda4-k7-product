@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-phone-ars.ps1" %*
exit /b %errorlevel%
