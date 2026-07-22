@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-audio-edge.ps1" %*
exit /b %errorlevel%
