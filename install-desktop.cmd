@echo off
rem Double-click: update this branch, build MatVision Studio and put a launcher on the desktop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-desktop.ps1" %*
echo.
pause
