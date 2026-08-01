@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
set "AURORA_EXIT=%ERRORLEVEL%"
if not "%AURORA_EXIT%"=="0" pause
exit /b %AURORA_EXIT%
