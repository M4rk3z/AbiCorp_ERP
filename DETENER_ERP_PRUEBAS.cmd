@echo off
setlocal
chcp 65001 >nul
title ABICORP - Detener ERP PRUEBAS
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-erp-test-postgres.ps1" -Port 5150
set "stopExitCode=%errorlevel%"

if not "%stopExitCode%"=="0" (
  echo.
  echo No fue posible detener el ERP de pruebas.
  echo Presiona una tecla para cerrar.
  pause >nul
)

endlocal & exit /b %stopExitCode%
