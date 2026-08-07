@echo off
setlocal
chcp 65001 >nul
title ABICORP - Detener Centro de Gestion
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-control-postgres.ps1" -EnvironmentName production -Port 5051
set "stopExitCode=%errorlevel%"

if not "%stopExitCode%"=="0" (
  echo.
  echo No fue posible detener el Centro de Gestion.
  echo Revisa el mensaje anterior y presiona una tecla para cerrar.
  pause >nul
)

endlocal & exit /b %stopExitCode%
