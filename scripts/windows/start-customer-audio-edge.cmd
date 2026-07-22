@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-audio-edge.ps1" -Role customer %*
exit /b %errorlevel%
